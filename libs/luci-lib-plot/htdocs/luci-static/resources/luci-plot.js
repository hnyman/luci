/*!
 * luci-plot.js
 *
 * Generic SVG plotting library for LuCI.
 *
 * Initially inspired by the SVG chart implementation in
 * luci-app-librespeed by BKPepe / OpenWrt LuCI.
 * The implementation has since been generalized to support
 * arbitrary numeric and time axes, independent Y scales and
 * data-source independent series definitions.
 *
 * Licensed under the Apache License, Version 2.0.
 */

'use strict';
'require baseclass';

if (!document.querySelector('link[href*="luci-plot.css"]')) {
    document.head.appendChild(E('link', {
        rel: 'stylesheet',
        href: L.resource('luci-plot.css')
    }));
}

return (() => {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const DEFAULT_GEOMETRY = {
        width: 600,
        height: 240,
        left: 50,
        right: 15,
        top: 15,
        bottom: 30
    };

    const TIME_STEPS = [
        1,
        5,
        10,
        30,

        60,
        5 * 60,
        10 * 60,
        15 * 60,
        30 * 60,

        60 * 60,
        2 * 60 * 60,
        3 * 60 * 60,
        6 * 60 * 60,
        12 * 60 * 60,

        24 * 60 * 60,
        2 * 24 * 60 * 60,
        7 * 24 * 60 * 60,
        14 * 24 * 60 * 60,

        30 * 24 * 60 * 60,
        90 * 24 * 60 * 60,

        365 * 24 * 60 * 60
    ];



    function makeIndexTicks(min, max, targetTicks)
    {
        const imin = Math.ceil(min);
        const imax = Math.floor(max);

        if (imin > imax)
            return [];

        const count = imax - imin + 1;

        /*
         * If there are only a few values, show every index.
         */
        if (count <= targetTicks + 2) {
            const ticks = [];

            for (let i = imin; i <= imax; i++)
                ticks.push(i);

            return ticks;
        }

        /*
         * Otherwise choose a pleasant integer step.
         */
        let step = Math.ceil(niceStep(imax - imin, targetTicks));

        if (step < 1)
            step = 1;

        const first = Math.ceil(imin / step) * step;
        const ticks = [];

        for (let i = first; i <= imax; i += step)
            ticks.push(i);

        return ticks;
    }

    function makeTimeTicks(min, max, targetTicks)
    {
        const range = max - min;

        let step = TIME_STEPS[TIME_STEPS.length - 1];

        for (let i = 0; i < TIME_STEPS.length; i++) {
            if (range / TIME_STEPS[i] <= targetTicks) {
                step = TIME_STEPS[i];
                break;
            }
        }

        const first =
            Math.ceil(min / step) * step;

        const ticks = [];

        for (let value = first;
        value <= max;
        value += step) {

            ticks.push(value);
        }

        return ticks;
    }
    function svgElement(name, attrs, text)
    {
        const el = document.createElementNS(SVG_NS, name);

        if (attrs) {
            Object.keys(attrs).forEach(key => {
                el.setAttribute(key, attrs[key]);
            });
        }

        if (text !== undefined)
            el.textContent = text;

        return el;
    }



    function getValueByKey(entry, key)
    {
        if (!key)
            return undefined;

        /*
         * Fast path for the usual case.
         */
        if (!key.includes('.'))
            return entry[key];

        return key.split('.').reduce((value, part) => {
            if (value === null || value === undefined)
                return undefined;

            return value[part];
        }, entry);
    }


    function keyAccessor(key)
    {
        return entry => getValueByKey(entry, key);
    }


    function resolveFormatter(format, digits, unit)
    {
        if (typeof format === 'function')
            return format;

        switch (format) {
        case 'integer':
            return value => Number.isFinite(value)
                ? String(Math.round(value)) + (unit ? ' ' + unit : '')
                : '–';

        case 'time':
            return value => new Date(value * 1000).toLocaleTimeString();

        case 'date':
            return value => new Date(value * 1000).toLocaleDateString();

        case 'datetime':
            return value => new Date(value * 1000).toLocaleString();

        case 'number':
        case undefined:
        case null:
            return value => {
                if (!Number.isFinite(value))
                    return '–';

                let text = value.toFixed(
                    Number.isInteger(digits) ? digits : 1
                );

                if (unit)
                    text += ' ' + unit;

                return text;
            };

        default:
            throw new Error(`Unknown formatter "${format}"`);
        }
    }


    function normalizePlotInput(entries, options)
    {
        /*
         * JSON/declarative form:
         *
         * LuciPlot.render('#plot', {
         *     plot: { ... },
         *     data: [ ... ]
         * });
         *
         * The traditional JavaScript form remains supported:
         *
         * LuciPlot.render('#plot', data, options);
         */
        if (!Array.isArray(entries) &&
            entries &&
            typeof entries === 'object' &&
            Array.isArray(entries.data)) {

            const plot = entries.plot || {};

            return {
                entries: entries.data,
                options: plot
            };
        }

        return {
            entries: entries,
            options: options || {}
        };
    }


    function defaultXDefinition()
    {
        return {
            type: 'index',
            label: 'Index',
            value: (entry, index) => index,
            format: value => String(Math.round(value))
        };
    }


    function normalizeXDefinition(x)
    {
        if (!x)
            return defaultXDefinition();

        /*
         * Convenience form:
         *
         * x: {
         *     type: 'index'
         * }
         */
        if (x.type === 'index') {
            return {
                type: 'index',
                label: x.label || 'Index',
                value: (entry, index) => index,
                format: x.format
                    ? resolveFormatter(x.format, x.digits)
                    : (value => String(Math.round(value)))
            };
        }

        /*
         * Convenience form:
         *
         * x: {
         *     key: 'timestamp',
         *     type: 'time'
         * }
         */
        if (x.type === 'time') {
            const key = x.key || 'timestamp';

            return {
                type: 'time',
                label: x.label || null,

                value:
                    x.value ||
                    keyAccessor(key),

                format: resolveFormatter(
                    x.format || 'datetime'
                )
            };
        }

        /*
         * Generic numeric X axis:
         *
         * x: {
         *     key: 'rpm'
         * }
         */
        if (x.key) {
            return {
                type: x.type || 'number',
                label: x.label || null,

                value:
                    x.value ||
                    keyAccessor(x.key),

                format: resolveFormatter(
                    x.format || 'number',
                    x.digits
                )
            };
        }

        /*
         * Fully custom form:
         *
         * x: {
         *     value: (entry, index) => ...,
         *     format: value => ...
         * }
         */
        return {
            type: x.type || 'number',
            label: x.label || null,
            value: x.value || ((entry, index) => index),
            format: resolveFormatter(
                x.format || 'number',
                x.digits
            )
        };
    }


    function hasFiniteOption(object, key)
    {
        return object &&
            object[key] !== null &&
            object[key] !== undefined &&
            Number.isFinite(Number(object[key]));
    }


    function normalizeAxes(axisOptions, rawSeries)
    {
        const usedIds = [];

        rawSeries.forEach(s => {
            const id = s.axis || 'default';

            if (!usedIds.includes(id))
                usedIds.push(id);
        });

        if (usedIds.length > 2)
            throw new Error('At most two Y axes are currently supported');

        const result = {};
        const usedSides = new Set();

        usedIds.forEach((id, index) => {
            const source = axisOptions && axisOptions[id]
            ? axisOptions[id]
            : {};

            let side = source.side || source.position;

            if (!side)
                side = index === 0 ? 'left' : 'right';

            if (side !== 'left' && side !== 'right')
                throw new Error(`Invalid side for Y axis "${id}"`);

            if (usedSides.has(side))
                throw new Error('Two visible Y axes must use different sides');

            usedSides.add(side);

            result[id] = Object.assign({}, source, {
                id: id,
                side: side,
                label: source.label || null,
                unit: source.unit || null,
                format: source.format !== undefined
                    ? resolveFormatter(source.format, source.digits)
                    : null
            });
        });

        return result;
    }


    function normalizeSeries(series, axes)
    {
        return series.map(s => {
            let value;

            if (typeof s.value === 'function')
                value = s.value;
            else if (s.key)
                value = keyAccessor(s.key);
            else
                throw new Error('Series needs either "key" or "value"');

            const axis = s.axis || 'default';

            if (!axes[axis])
                throw new Error(`Unknown Y axis "${axis}"`);

            const hasMin =
                typeof s.minValue === 'function' || !!s.minKey;
            const hasMax =
                typeof s.maxValue === 'function' || !!s.maxKey;

            if (hasMin !== hasMax)
                throw new Error(
            'Series band needs both minKey/minValue and maxKey/maxValue'
            );

            let minValue = null;
            let maxValue = null;

            if (hasMin) {
                minValue = typeof s.minValue === 'function'
                    ? s.minValue
                    : keyAccessor(s.minKey);

                maxValue = typeof s.maxValue === 'function'
                    ? s.maxValue
                    : keyAccessor(s.maxKey);
            }

            const unit = s.unit !== undefined
            ? s.unit
            : axes[axis].unit;

            const format = resolveFormatter(
                s.format || 'number',
                s.digits,
                unit
            );

            return Object.assign({}, s, {
                axis: axis,
                unit: unit,
                value: value,
                minValue: minValue,
                maxValue: maxValue,
                format: format
            });
        });
    }


    function collectData(entries, xdef, series)
    {
        const result = [];

        entries.forEach((entry, index) => {
            const x = Number(xdef.value(entry, index));

            if (!Number.isFinite(x))
                return;

            const values = [];
            const mins = [];
            const maxs = [];

            series.forEach(s => {
                const rawY = s.value(entry, index);
                const y = rawY == null ? NaN : Number(rawY);

                values.push(Number.isFinite(y) ? y : null);

                if (s.minValue && s.maxValue) {
                    const rawMin = s.minValue(entry, index);
                    const rawMax = s.maxValue(entry, index);

                    const ymin = rawMin == null ? NaN : Number(rawMin);
                    const ymax = rawMax == null ? NaN : Number(rawMax);

                    mins.push(Number.isFinite(ymin) ? ymin : null);
                    maxs.push(Number.isFinite(ymax) ? ymax : null);
                }
                else {
                    mins.push(null);
                    maxs.push(null);
                }
            });

            result.push({
                entry: entry,
                index: index,
                x: x,
                values: values,
                mins: mins,
                maxs: maxs
            });
        });

        return result;
    }


    function calculateScale(data, series, axes, geometry)
    {
        if (!data.length)
            return null;

        const xValues = data.map(p => p.x);

        let xmin = Math.min(...xValues);
        let xmax = Math.max(...xValues);

        if (xmin === xmax) {
            xmin -= 0.5;
            xmax += 0.5;
        }

        const plotWidth =
            geometry.width -
        geometry.left -
        geometry.right;

        const plotHeight =
            geometry.height -
        geometry.top -
        geometry.bottom;

        const axisScales = {};
        let haveYData = false;

        Object.keys(axes).forEach(axisId => {
            const yValues = [];

            data.forEach(point => {
                series.forEach((s, seriesIndex) => {
                    if (s.axis !== axisId)
                        return;

                    if (Number.isFinite(point.values[seriesIndex]))
                        yValues.push(point.values[seriesIndex]);

                    if (Number.isFinite(point.mins[seriesIndex]))
                        yValues.push(point.mins[seriesIndex]);

                    if (Number.isFinite(point.maxs[seriesIndex]))
                        yValues.push(point.maxs[seriesIndex]);
                });
            });

            if (!yValues.length) {
                axisScales[axisId] = null;
                return;
            }

            haveYData = true;

            let ymin = hasFiniteOption(axes[axisId], 'min')
                ? Number(axes[axisId].min)
                : Math.min(...yValues);
            let ymax = hasFiniteOption(axes[axisId], 'max')
                ? Number(axes[axisId].max)
                : Math.max(...yValues);

            if (ymin > ymax)
                throw new Error(`Y axis "${axisId}" has min > max`);

            const fixedMin = hasFiniteOption(axes[axisId], 'min');
            const fixedMax = hasFiniteOption(axes[axisId], 'max');

            if (ymin === ymax) {
                const pad = Math.abs(ymin) * 0.05 || 1;

                if (!fixedMin)
                    ymin -= pad;
                if (!fixedMax)
                    ymax += pad;
            }
            else {
                const pad = (ymax - ymin) * 0.08;

                if (!fixedMin)
                    ymin -= pad;
                if (!fixedMax)
                    ymax += pad;
            }

            axisScales[axisId] = {
                ymin: ymin,
                ymax: ymax,
                ys: y =>
                    geometry.top +
                (1 - (y - ymin) / (ymax - ymin)) *
                plotHeight
            };
        });

        if (!haveYData)
            return null;

        return {
            xmin: xmin,
            xmax: xmax,
            axes: axisScales,

            xs: x =>
                geometry.left +
            ((x - xmin) / (xmax - xmin)) *
            plotWidth
        };
    }


    function niceStep(range, targetTicks)
    {
        const rawStep = range / Math.max(1, targetTicks);

        const power = Math.pow(
        10,
        Math.floor(Math.log10(rawStep))
        );

        const fraction = rawStep / power;

        let niceFraction;

        if (fraction <= 1)
            niceFraction = 1;
        else if (fraction <= 2)
        niceFraction = 2;
        else if (fraction <= 5)
        niceFraction = 5;
        else
            niceFraction = 10;

        return niceFraction * power;
    }


    function makeNumericTicks(min, max, targetTicks)
    {
        if (!Number.isFinite(min) ||
            !Number.isFinite(max) ||
            min === max)
        return [min];

        const range = max - min;
        const step = niceStep(range, targetTicks);

        const first =
            Math.ceil(min / step) * step;

        const last =
            Math.floor(max / step) * step;

        const ticks = [];

        /*
         * Kleine Toleranz gegen Rundungsfehler.
         */
        const epsilon = step * 1e-9;

        for (let value = first;
        value <= last + epsilon;
        value += step) {

            ticks.push(
            Math.abs(value) < epsilon ? 0 : value
            );
        }

        return ticks;
    }


    function formatNumber(value, step)
    {
        if (!Number.isFinite(value))
            return '';

        let digits = 0;

        if (step < 1) {
            digits =
                Math.max(
            0,
            -Math.floor(Math.log10(step))
            );
        }

        /*
         * Bei 2.5, 0.25 usw. brauchen wir ggf.
         * eine zusätzliche Nachkommastelle.
         */
        const scaled =
            step * Math.pow(10, digits);

        if (Math.abs(scaled - Math.round(scaled)) > 1e-9)
            digits++;

        return value.toFixed(digits);
    }

    function formatAxisTick(axis, value, step)
    {
        if (typeof axis.format === 'function')
            return axis.format(value, step);

        return formatNumber(value, step);
    }


    function renderYAxes(svg, scale, axes, geometry)
    {
        const axisIds = Object.keys(axes)
            .filter(id => scale.axes[id]);

        if (!axisIds.length)
            return;

        const primaryId =
            axisIds.find(id => axes[id].side === 'left') || axisIds[0];
        const primaryScale = scale.axes[primaryId];
        const primaryTicks = makeNumericTicks(
        primaryScale.ymin,
        primaryScale.ymax,
        5
        );

        const grid = svgElement('g', {
            class: 'luci-plot-grid'
        });

        primaryTicks.forEach(value => {
            const y = primaryScale.ys(value);

            grid.appendChild(svgElement('line', {
                x1: geometry.left,
                y1: y,
                x2: geometry.width - geometry.right,
                y2: y
            }));
        });

        svg.appendChild(grid);

        axisIds.forEach(axisId => {
            const axisDef = axes[axisId];
            const axisScale = scale.axes[axisId];
            const ticks = makeNumericTicks(
            axisScale.ymin,
            axisScale.ymax,
            5
            );

            let step = 1;

            if (ticks.length > 1)
                step = ticks[1] - ticks[0];

            const right = axisDef.side === 'right';
            const x = right
            ? geometry.width - geometry.right
            : geometry.left;
            const textX = right ? x + 7 : x - 7;
            const tickX = right ? x + 5 : x - 5;
            const anchor = right ? 'start' : 'end';
            const group = svgElement('g', {
                class: `luci-plot-y-axis luci-plot-y-axis-${axisDef.side}`
            });

            ticks.forEach(value => {
                const y = axisScale.ys(value);

                group.appendChild(svgElement('line', {
                    x1: x,
                    y1: y,
                    x2: tickX,
                    y2: y
                }));

                group.appendChild(svgElement('text', {
                    x: textX,
                    y: y + 4,
                    class: 'luci-plot-axis-label',
                    'text-anchor': anchor
                }, formatAxisTick(axisDef, value, step)));
            });

            const titleParts = [];

            if (axisDef.label)
                titleParts.push(axisDef.label);

            if (axisDef.unit)
                titleParts.push(`[${axisDef.unit}]`);

            if (titleParts.length) {
                group.appendChild(svgElement('text', {
                    x: x,
                    y: geometry.top - 4,
                    class: 'luci-plot-axis-label luci-plot-y-axis-title',
                    'text-anchor': right ? 'end' : 'start'
                }, titleParts.join(' ')));
            }

            svg.appendChild(group);
        });
    }


    function renderXAxis(svg, scale, xdef, geometry)
    {
        const axis = svgElement('g', {
            class: 'luci-plot-x-axis'
        });

        let ticks;

        switch (xdef.type) {

            case 'index':
                ticks =
                makeIndexTicks(
            scale.xmin,
            scale.xmax,
            5
            );
            break;

            case 'time':
                ticks =
                makeTimeTicks(
            scale.xmin,
            scale.xmax,
            5
            );
            break;

            default:
                ticks =
                makeNumericTicks(
            scale.xmin,
            scale.xmax,
            5
            );
            break;
        }

        ticks.forEach(value => {
            const x = scale.xs(value);

            axis.appendChild(svgElement('line', {
                x1: x,
                y1: geometry.height - geometry.bottom,
                x2: x,
                y2: geometry.height - geometry.bottom + 5
            }));

            axis.appendChild(svgElement('text', {
                x: x,
                y: geometry.height - 8,
                class: 'luci-plot-axis-label',
                'text-anchor': 'middle'
            }, xdef.format(value)));
        });

        svg.appendChild(axis);
    }

    function renderSeries(svg, data, scale, series)
    {
        series.forEach((s, seriesIndex) => {
            /*
             * Optional min/max envelope. Missing limits break the band,
             * just like missing Y values break the line.
             */
            if (s.minValue && s.maxValue) {
                let band = [];

                function flushBand()
                {
                    if (band.length < 2) {
                        band = [];
                        return;
                    }

                    const upper = band
                        .map(p => `${scale.xs(p.x)},${scale.axes[s.axis].ys(p.max)}`);

                    const lower = band
                        .slice()
                            .reverse()
                                .map(p => `${scale.xs(p.x)},${scale.axes[s.axis].ys(p.min)}`);

                    svg.appendChild(svgElement('polygon', {
                        class:
                            `luci-plot-band luci-plot-series-${seriesIndex}`,
                        points: upper.concat(lower).join(' ')
                    }));

                    band = [];
                }

                data.forEach(point => {
                    const ymin = point.mins[seriesIndex];
                    const ymax = point.maxs[seriesIndex];

                    if (!Number.isFinite(ymin) ||
                        !Number.isFinite(ymax)) {
                        flushBand();
                        return;
                    }

                    band.push({
                        x: point.x,
                        min: ymin,
                        max: ymax
                    });
                });

                flushBand();
            }

            let current = [];

            function flush()
            {
                if (!current.length)
                    return;

                const points = current
                    .map(p => `${scale.xs(p.x)},${scale.axes[s.axis].ys(p.y)}`)
                        .join(' ');

                svg.appendChild(svgElement('polyline', {
                    class:
                        `luci-plot-line luci-plot-series-${seriesIndex}`,
                    points: points,
                    fill: 'none'
                }));

                current = [];
            }

            data.forEach(point => {
                const y = point.values[seriesIndex];

                /*
                 * Missing values break the line instead
                 * of connecting across the gap.
                 */
                if (!Number.isFinite(y)) {
                    flush();
                    return;
                }

                current.push({
                    x: point.x,
                    y: y
                });
            });

            flush();
        });
    }


    function colorizeBands(svg, series)
    {
        series.forEach((s, index) => {
            if (!s.minValue || !s.maxValue)
                return;

            const line = svg.querySelector(
            `.luci-plot-line.luci-plot-series-${index}`
            );

            if (!line)
                return;

            const stroke = getComputedStyle(line).stroke;

            if (!stroke || stroke === 'none')
                return;

            svg.querySelectorAll(
            `.luci-plot-band.luci-plot-series-${index}`
            ).forEach(band => band.setAttribute('fill', stroke));
        });
    }


    function findNearestPoint(data, x)
    {
        if (!data.length)
            return null;

        let lo = 0;
        let hi = data.length - 1;

        if (x <= data[lo].x)
            return data[lo];

        if (x >= data[hi].x)
            return data[hi];

        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;

            if (data[mid].x < x)
                lo = mid;
            else
                hi = mid;
        }

        return (x - data[lo].x <= data[hi].x - x)
        ? data[lo]
        : data[hi];
    }


    function renderHover(target, svg, data, scale, xdef, series, geometry)
    {
        const hoverData = data
            .slice()
                .sort((a, b) => a.x - b.x);

        const hover = svgElement('g', {
            class: 'luci-plot-hover',
            visibility: 'hidden'
        });

        const line = svgElement('line', {
            class: 'luci-plot-hover-line',
            y1: geometry.top,
            y2: geometry.height - geometry.bottom
        });

        hover.appendChild(line);

        const points = series.map((s, index) => {
            const point = svgElement('circle', {
                class: `luci-plot-hover-point luci-plot-series-${index}`,
                r: 3.5
            });

            /*
             * Copy the actual line colour. This keeps hover markers
             * independent of the application's colour scheme.
             */
            const seriesLine = svg.querySelector(
            `.luci-plot-line.luci-plot-series-${index}`
            );

            if (seriesLine) {
                const stroke = getComputedStyle(seriesLine).stroke;

                if (stroke && stroke !== 'none')
                    point.setAttribute('stroke', stroke);
            }

            hover.appendChild(point);
            return point;
        });

        svg.appendChild(hover);

        const overlay = svgElement('rect', {
            class: 'luci-plot-hover-overlay',
            x: geometry.left,
            y: geometry.top,
            width:
                geometry.width - geometry.left - geometry.right,
            height:
                geometry.height - geometry.top - geometry.bottom
        });

        svg.appendChild(overlay);

        const tooltip = document.createElement('div');

        tooltip.className = 'luci-plot-tooltip';
        tooltip.hidden = true;
        target.appendChild(tooltip);

        function hide()
        {
            hover.setAttribute('visibility', 'hidden');
            tooltip.hidden = true;
        }

        function setTooltip(point)
        {
            tooltip.replaceChildren();

            const xLine = document.createElement('div');
            const xText = xdef.format(point.x);

            xLine.className = 'luci-plot-tooltip-x';
            xLine.textContent = xdef.label
            ? `${xdef.label}: ${xText}`
            : xText;

            tooltip.appendChild(xLine);

            series.forEach((s, index) => {
                const y = point.values[index];

                if (!Number.isFinite(y))
                    return;

                const row = document.createElement('div');
                const marker = document.createElement('span');
                const label = document.createElement('span');
                const value = document.createElement('span');

                row.className = 'luci-plot-tooltip-row';
                marker.className =
                    `luci-plot-tooltip-marker luci-plot-marker-${index}`;
                label.className = 'luci-plot-tooltip-label';
                value.className = 'luci-plot-tooltip-value';

                label.textContent = s.label || `Series ${index + 1}`;
                value.textContent = s.format(y);

                row.appendChild(marker);
                row.appendChild(label);
                row.appendChild(value);
                tooltip.appendChild(row);
            });
        }

        function positionTooltip(event)
        {
            const targetRect = target.getBoundingClientRect();
            const margin = 12;

            let left = event.clientX - targetRect.left + margin;
            let top = event.clientY - targetRect.top + margin;

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;

            const width = tooltip.offsetWidth;
            const height = tooltip.offsetHeight;

            if (left + width + 4 > target.clientWidth)
                left = event.clientX - targetRect.left - width - margin;

            if (top + height + 4 > target.clientHeight)
                top = event.clientY - targetRect.top - height - margin;

            tooltip.style.left = `${Math.max(4, left)}px`;
            tooltip.style.top = `${Math.max(4, top)}px`;
        }

        overlay.addEventListener('pointermove', event => {
            const rect = svg.getBoundingClientRect();

            if (!rect.width)
                return;

            const svgX =
                (event.clientX - rect.left) *
            geometry.width / rect.width;

            const plotLeft = geometry.left;
            const plotRight = geometry.width - geometry.right;
            const clampedX =
                Math.max(plotLeft, Math.min(plotRight, svgX));

            const domainX =
                scale.xmin +
            ((clampedX - plotLeft) / (plotRight - plotLeft)) *
            (scale.xmax - scale.xmin);

            const point = findNearestPoint(hoverData, domainX);

            if (!point)
                return;

            const x = scale.xs(point.x);

            line.setAttribute('x1', x);
            line.setAttribute('x2', x);

            points.forEach((marker, index) => {
                const y = point.values[index];

                if (!Number.isFinite(y)) {
                    marker.setAttribute('visibility', 'hidden');
                    return;
                }

                marker.setAttribute('visibility', 'visible');
                marker.setAttribute('cx', x);
                marker.setAttribute('cy', scale.axes[series[index].axis].ys(y));
            });

            hover.setAttribute('visibility', 'visible');
            setTooltip(point);
            tooltip.hidden = false;
            positionTooltip(event);
        });

        overlay.addEventListener('pointerleave', hide);

        return {
            group: hover,
            overlay: overlay,
            tooltip: tooltip,
            hide: hide
        };
    }


    function renderLegend(container, series)
    {
        const legend = document.createElement('div');

        legend.className = 'luci-plot-legend';

        series.forEach((s, index) => {
            const item = document.createElement('span');

            item.className = 'luci-plot-legend-item';

            const marker = document.createElement('span');

            marker.className =
                `luci-plot-marker luci-plot-marker-${index}`;

            const label = document.createElement('span');

            label.textContent = s.label || `Series ${index + 1}`;

            item.appendChild(marker);
            item.appendChild(label);

            legend.appendChild(item);
        });

        container.appendChild(legend);
    }


    function render(target, entries, options = {})
    {
        if (typeof target === 'string')
            target = document.querySelector(target);

        if (!target)
            throw new Error('Plot target not found');

        const input = normalizePlotInput(entries, options);

        entries = input.entries;
        options = input.options;

        if (!Array.isArray(entries))
            throw new Error(
                'Entries must be an array or a plot object with a "data" array'
            );

        if (!Array.isArray(options.series) ||
            !options.series.length)
            throw new Error('At least one series is required');

        const axes = normalizeAxes(options.axes, options.series);

        const geometry =
            Object.assign({}, DEFAULT_GEOMETRY,
        options.geometry || {});

        const haveRightAxis = Object.keys(axes)
            .some(id => axes[id].side === 'right');

        if (haveRightAxis &&
            (!options.geometry || options.geometry.right === undefined))
        geometry.right = 50;

        const xdef = normalizeXDefinition(options.x);
        const series = normalizeSeries(options.series, axes);

        const data = collectData(entries, xdef, series);

        const scale =
            calculateScale(
        data,
        series,
        axes,
        geometry
        );

        target.replaceChildren();
        target.classList.add('luci-plot-container');

        if (!scale) {
            target.textContent = 'No data';
            return null;
        }

        if (options.title) {
            const title = document.createElement('div');

            title.className = 'luci-plot-title';
            title.textContent = options.title;

            target.appendChild(title);
        }

        const svg = svgElement('svg', {
            class: 'luci-plot',
            viewBox:
                `0 0 ${geometry.width} ${geometry.height}`,
            role: 'img'
        });

        renderYAxes(svg, scale, axes, geometry);
        renderXAxis(svg, scale, xdef, geometry);
        renderSeries(svg, data, scale, series);

        target.appendChild(svg);
        colorizeBands(svg, series);

        const hover = options.hover === false
        ? null
        : renderHover(
        target, svg, data, scale, xdef, series, geometry
        );

        if (options.legend !== false)
            renderLegend(target, series);

        return {
            svg: svg,
            data: data,
            scale: scale,
            x: xdef,
            series: series,
            axes: axes,
            hover: hover
        };

    }


    return baseclass.extend({
        render: render
    });
})();
