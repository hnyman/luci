#include <rpcd/plugin.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <uci.h>
#include <limits.h>
#include <stdio.h>
#include <rrd.h>
#include <math.h>
#include <inttypes.h>
#include <stdio.h>
#include <time.h>

static char rrd_base_dir[PATH_MAX];
static int rrd_load_config(void);

enum {
    XPORT_START,
    XPORT_END,
    XPORT_STEP,
    XPORT_DEFINITIONS,
    __XPORT_MAX
};

static const struct blobmsg_policy xport_policy[__XPORT_MAX] = {
    [XPORT_START] = { .name = "start", .type = BLOBMSG_TYPE_UNSPEC },
    [XPORT_END]   = { .name = "end",   .type = BLOBMSG_TYPE_UNSPEC },
    [XPORT_STEP]        = { .name = "step",        .type = BLOBMSG_TYPE_INT32 },
    [XPORT_DEFINITIONS] = { .name = "definitions", .type = BLOBMSG_TYPE_ARRAY },
};

static uint64_t get_timestamp(struct blob_attr *attr)
{
    if (blobmsg_type(attr) == BLOBMSG_TYPE_INT64)
        return blobmsg_get_u64(attr);

    return blobmsg_get_u32(attr);
}

static char *
prepare_definition(const char *def)
{
    const char *path, *end, *eq;
    char filename[PATH_MAX];
    char resolved[PATH_MAX];
    char *result;
    size_t len, base_len, total;

    if (strncmp(def, "DEF:", 4) != 0)
        return strdup(def);

    eq = strchr(def + 4, '=');
    if (!eq || eq == def + 4)
        return NULL;

    path = eq + 1;
    end = strchr(path, ':');

    if (!end)
        return NULL;

    len = end - path;

    if (!len || len >= sizeof(filename))
        return NULL;

    memcpy(filename, path, len);
    filename[len] = '\0';

    if (!realpath(filename, resolved))
        return NULL;

    base_len = strlen(rrd_base_dir);
    len = strlen(resolved);

    if (!base_len ||
        strncmp(resolved, rrd_base_dir, base_len) ||
        resolved[base_len] != '/' ||
        len < 4 ||
        strcmp(resolved + len - 4, ".rrd"))
        return NULL;

    total = (size_t)(path - def) +
    len + strlen(end) + 1;

    result = malloc(total);
    if (!result)
        return NULL;

    snprintf(result, total, "%.*s%s%s",
             (int)(path - def), def, resolved, end);

    return result;
}

#define MAX_DEFINITIONS 64
#define MAX_ROWS 10000
#define MAX_COLUMNS 64

static int
rrd_xport_handler(struct ubus_context *ctx,
                  struct ubus_object *obj,
                  struct ubus_request_data *req,
                  const char *method,
                  struct blob_attr *msg)
{
    struct blob_attr *tb[__XPORT_MAX] = {};
    struct blob_attr *entry;
    struct blob_buf reply = {};

    const char *argv[4 + MAX_DEFINITIONS];
    char *definitions[MAX_DEFINITIONS] = {};
    char start_arg[32], end_arg[32], step_arg[32];

    char **legend = NULL;
    rrd_value_t *data = NULL;

    uint64_t requested_start, requested_end;
    uint32_t requested_step;

    time_t start, end;
    unsigned long step, columns = 0;
    int xsize = 0;
    int argc = 0;
    int remaining;
    int count = 0;
    int xport_count = 0;
    int ret = UBUS_STATUS_INVALID_ARGUMENT;
    size_t rows = 0;

    rrd_base_dir[0] = '\0';

    if (rrd_load_config() != 0)
        return UBUS_STATUS_UNKNOWN_ERROR;

    if (!msg)
        return UBUS_STATUS_INVALID_ARGUMENT;

    blobmsg_parse(xport_policy, __XPORT_MAX, tb,
                  blob_data(msg), blob_len(msg));

    if (!tb[XPORT_START] || !tb[XPORT_END] ||
        !tb[XPORT_STEP] || !tb[XPORT_DEFINITIONS])
        return UBUS_STATUS_INVALID_ARGUMENT;

    if ((blobmsg_type(tb[XPORT_START]) != BLOBMSG_TYPE_INT32 &&
        blobmsg_type(tb[XPORT_START]) != BLOBMSG_TYPE_INT64) ||
        (blobmsg_type(tb[XPORT_END]) != BLOBMSG_TYPE_INT32 &&
        blobmsg_type(tb[XPORT_END]) != BLOBMSG_TYPE_INT64))
        return UBUS_STATUS_INVALID_ARGUMENT;

    requested_start = get_timestamp(tb[XPORT_START]);
    requested_end = get_timestamp(tb[XPORT_END]);
    requested_step = blobmsg_get_u32(tb[XPORT_STEP]);

    if (requested_start >= requested_end ||
        requested_step == 0 ||
        requested_end > INT64_MAX)
        return UBUS_STATUS_INVALID_ARGUMENT;

    /*
     * Begrenzung der maximalen Antwortgröße.
     */
    if ((requested_end - requested_start) /
        requested_step > MAX_ROWS)
        return UBUS_STATUS_INVALID_ARGUMENT;

    start = (time_t)requested_start;
    end = (time_t)requested_end;

    if (start < 0 || end < 0 ||
        (uint64_t)start != requested_start ||
        (uint64_t)end != requested_end)
        return UBUS_STATUS_INVALID_ARGUMENT;

    snprintf(start_arg, sizeof(start_arg),
             "%" PRIu64, requested_start);

    snprintf(end_arg, sizeof(end_arg),
             "%" PRIu64, requested_end);

    snprintf(step_arg, sizeof(step_arg),
             "%u", requested_step);

    argv[argc++] = "xport";
    argv[argc++] = "--start";
    argv[argc++] = start_arg;
    argv[argc++] = "--end";
    argv[argc++] = end_arg;

    /*
     * Für --step benötigen wir zwei weitere Argumente.
     * Die Definitionen werden separat übergeben.
     */
    const char *args[7 + MAX_DEFINITIONS];

    memcpy(args, argv, argc * sizeof(*argv));
    args[argc++] = "--step";
    args[argc++] = step_arg;

    blobmsg_for_each_attr(entry, tb[XPORT_DEFINITIONS], remaining) {
        const char *def;

        if (blobmsg_type(entry) != BLOBMSG_TYPE_STRING ||
            count >= MAX_DEFINITIONS)
            goto cleanup;

        def = blobmsg_get_string(entry);

        if (!*def || strlen(def) > 1024)
            goto cleanup;

        if (strncmp(def, "DEF:", 4) &&
            strncmp(def, "CDEF:", 5) &&
            strncmp(def, "XPORT:", 6))
            goto cleanup;

        definitions[count] = prepare_definition(def);

        if (!definitions[count])
            goto cleanup;

        if (!strncmp(def, "XPORT:", 6))
            xport_count++;

        args[argc++] = definitions[count++];
    }

    if (!count || !xport_count)
        goto cleanup;

    /*
     * Die XPORT-Auswertung.
     */
    rrd_clear_error();

    if (rrd_xport(argc, args, &xsize,
        &start, &end, &step,
        &columns, &legend, &data) != 0) {
        fprintf(stderr, "rrd_xport: %s\n", rrd_get_error());
    ret = UBUS_STATUS_UNKNOWN_ERROR;
    goto cleanup;
        }

        if (!step || end < start ||
            columns == 0 || columns > MAX_COLUMNS)
            goto cleanup;

        rows = (end - start) / step;

        if (rows > MAX_ROWS)
            goto cleanup;

    blob_buf_init(&reply, 0);

    blobmsg_add_u64(&reply, "start", (uint64_t)start);
    blobmsg_add_u64(&reply, "end", (uint64_t)end);
    blobmsg_add_u32(&reply, "step", step);

    void *legend_array = blobmsg_open_array(&reply, "legend");

    for (unsigned long c = 0; c < columns; c++)
        blobmsg_add_string(&reply, NULL,
                           legend && legend[c] ? legend[c] : "");

        blobmsg_close_array(&reply, legend_array);

    void *data_array = blobmsg_open_array(&reply, "data");

    for (size_t r = 0; r < rows; r++) {
        void *row = blobmsg_open_array(&reply, NULL);

        for (unsigned long c = 0; c < columns; c++) {
            double value = data[r * columns + c];

            if (isfinite(value))
                blobmsg_add_double(&reply, NULL, value);
            else
                blobmsg_add_field(&reply, BLOBMSG_TYPE_UNSPEC,
                                  NULL, NULL, 0);
        }

        blobmsg_close_array(&reply, row);
    }

    blobmsg_close_array(&reply, data_array);

    ret = ubus_send_reply(ctx, req, reply.head);
    blob_buf_free(&reply);

    cleanup:
    for (int i = 0; i < count; i++)
        free(definitions[i]);

    if (legend) {
        for (unsigned long i = 0; i < columns; i++)
            free(legend[i]);
        free(legend);
    }

    free(data);

    return ret;
}

static int
rrd_load_config(void)
{
    struct uci_context *ctx;
    struct uci_ptr ptr;
    char lookup[] = "luci_statistics.collectd_rrdtool.DataDir";
    const char *value;
    char resolved[PATH_MAX];
    int ret = -1;

    ctx = uci_alloc_context();
    if (!ctx)
        return -1;

    if (uci_lookup_ptr(ctx, &ptr, lookup, true) != UCI_OK ||
        !(ptr.flags & UCI_LOOKUP_COMPLETE) ||
        !ptr.o || ptr.o->type != UCI_TYPE_STRING)
        goto out;

    value = ptr.o->v.string;

    if (!value || value[0] != '/')
        goto out;

    if (!realpath(value, resolved))
        goto out;

    if (strlen(resolved) >= sizeof(rrd_base_dir))
        goto out;

    strcpy(rrd_base_dir, resolved);
    ret = 0;

    out:
    uci_free_context(ctx);
    return ret;
}

static int
rrd_plugin_init(const struct rpc_daemon_ops *ops,
                struct ubus_context *ctx)
{
    static const struct ubus_method methods[] = {
        UBUS_METHOD("xport", rrd_xport_handler, xport_policy),
    };

    static struct ubus_object_type type =
        UBUS_OBJECT_TYPE("rrd", methods);

    static struct ubus_object obj = {
        .name = "rrd",
        .type = &type,
        .methods = methods,
        .n_methods = ARRAY_SIZE(methods),
    };

    return ubus_add_object(ctx, &obj);
}

struct rpc_plugin rpc_plugin = {
    .init = rrd_plugin_init,
};
