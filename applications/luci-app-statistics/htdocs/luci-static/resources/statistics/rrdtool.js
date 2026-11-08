'use strict';
'require baseclass';
'require fs';
'require uci';
'require tools.prng as random';
'require rpc';

function subst(str, val) {
	return str.replace(/%(H|pn|pi|dt|di|ds)/g, function(m, p1) {
		switch (p1) {
		case 'H':  return val.host   || '';
		case 'pn': return val.plugin || '';
		case 'pi': return val.pinst  || '';
		case 'dt': return val.dtype  || '';
		case 'di': return val.dinst  || '';
		case 'ds': return val.dsrc   || '';
		}
	});
}

const callRrdXport = rpc.declare({
	object: 'rrd',
	method: 'xport',
	params: [ 'start', 'end', 'step', 'definitions' ]
});

const i18n = L.Class.singleton({
	title(host, plugin, pinst, dtype, dinst, user_title) {
		const title = user_title || 'p=%s/pi=%s/dt=%s/di=%s'.format(
			plugin,
			pinst || '(nil)',
			dtype || '(nil)',
			dinst || '(nil)'
		);

		return subst(title, {
			host: host,
			plugin: plugin,
			pinst: pinst,
			dtype: dtype,
			dinst: dinst
		});
	},

	label(host, plugin, pinst, dtype, dinst, user_label) {
		const label = user_label || 'dt=%s/%di=%s'.format(
			dtype || '(nil)',
			dinst || '(nil)'
		);

		return subst(label, {
			host: host,
			plugin: plugin,
			pinst: pinst,
			dtype: dtype,
			dinst: dinst
		});
	},

	ds(host, source) {
		const label = source.title || 'dt=%s/di=%s/ds=%s'.format(
			source.type     || '(nil)',
			source.instance || '(nil)',
			source.ds       || '(nil)'
		);

		return subst(label, {
			host: host,
			dtype: source.type,
			dinst: source.instance,
			dsrc: source.ds
		});
	}
});

const colors = L.Class.singleton({
	fromString(s) {
		if (typeof(s) != 'string' || !s.match(/^[0-9a-fA-F]{6}$/))
			return null;

		return [
			parseInt(s.substring(0, 2), 16),
			parseInt(s.substring(2, 4), 16),
			parseInt(s.substring(4, 6), 16)
		];
	},

	asString(c) {
		if (!Array.isArray(c) || c.length != 3)
			return null;

		return '%02x%02x%02x'.format(c[0], c[1], c[2]);
	},

	defined(i) {
		const t = [
			[230, 25, 75],
			[245, 130, 48],
			[255, 225, 25],
			[60, 180, 75],
			[70, 240, 240],
			[0, 130, 200],
			[0, 0, 128],
			[170, 110, 40]
		];

		return this.asString(t[i % t.length]);
	},

	random() {
		const r = random.get(255);
		const g = random.get(255);
		let min = 0, max = 255;

		if (r + g < 255)
			min = 255 - r - g;
		else
			max = 511 - r - g;

		const b = min + Math.floor(random.get() * (max - min));

		return [ r, g, b ];
	},

	faded(fg, bg, alpha) {
		fg = this.fromString(fg) || (this.asString(fg) ? fg : null);
		bg = this.fromString(bg) || (this.asString(bg) ? bg : [255, 255, 255]);
		alpha = !isNaN(alpha) ? +alpha : 0.25;

		if (!fg)
			return null;

		return [
			(alpha * fg[0]) + ((1.0 - alpha) * bg[0]),
			(alpha * fg[1]) + ((1.0 - alpha) * bg[1]),
			(alpha * fg[2]) + ((1.0 - alpha) * bg[2])
		];
	}
});

let rrdtree = {};
let graphdefs = {};

return baseclass.extend({
	__init__() {
		this.opts = {};
	},

	load() {
		return Promise.all([
			L.resolveDefault(fs.list('/www' + L.resource('statistics/rrdtool/definitions')), []),
			fs.trimmed('/proc/sys/kernel/hostname'),
			uci.load('luci_statistics')
		]).then(L.bind(function([definitions, hostname]) {
			this.opts.host      = uci.get('luci_statistics', 'collectd', 'Hostname')        || hostname;
			this.opts.timespan  = uci.get('luci_statistics', 'rrdtool', 'default_timespan') || 3600;
			this.opts.width     = uci.get('luci_statistics', 'rrdtool', 'image_width')      || 600;
			this.opts.height    = uci.get('luci_statistics', 'rrdtool', 'image_height')     || 150;
			this.opts.rrdpath   = (uci.get('luci_statistics', 'collectd_rrdtool', 'DataDir') || '/tmp/rrd').replace(/\/$/, '');
			this.opts.rrasingle = (uci.get('luci_statistics', 'collectd_rrdtool', 'RRASingle') == '1');
			this.opts.rramax    = (uci.get('luci_statistics', 'collectd_rrdtool', 'RRAMax') == '1');

			graphdefs = {};

			const tasks = [ this.scan() ];

			for (let def of definitions) {
				const m = def.name.match(/^(.+)\.js$/);

				if (def.type != 'file' || m == null)
					continue;

				tasks.push(L.require('statistics.rrdtool.definitions.' + m[1]).then(L.bind(function(name, def) {
					graphdefs[name] = def;
				}, this, m[1])));
			}

			return Promise.all(tasks);
		}, this));
	},

	ls() {
		const dir = this.opts.rrdpath;

		return L.resolveDefault(fs.list(dir), []).then(function(entries) {
			const tasks = [];

			for (let entr of entries) {
				if (entr.type != 'directory')
					continue;

				tasks.push(L.resolveDefault(fs.list(dir + '/' + entr.name), []).then(L.bind(function(entries) {
					const tasks = [];

					for (let entrj of entries) {
						if (entrj.type != 'directory')
							continue;

						tasks.push(L.resolveDefault(fs.list(dir + '/' + this.name + '/' + entrj.name), []).then(L.bind(function(entries) {
							return Object.assign(this, {
								entries: entries.filter(function(e) {
									return e.type == 'file' && e.name.match(/\.rrd$/);
								})
							});
						}, entrj)));
					}

					return Promise.all(tasks).then(L.bind(function(entries) {
						return Object.assign(this, {
							entries: entries
						});
					}, this));
				}, entr)));
			}

			return Promise.all(tasks);
		});
	},

	scan() {
		return this.ls().then(L.bind(function(entries) {
			rrdtree = {};

			for (let entr of entries) {
				const hostInstance = entr.name;

				rrdtree[hostInstance] = rrdtree[hostInstance] || {};

				for (let jentr of entr.entries) {
					const m = jentr.name.match(/^([^-]+)(?:-(.+))?$/);

					if (!m)
						continue;

					const pluginName = m[1];
					const pluginInstance = m[2] || '';

					rrdtree[hostInstance][pluginName] = rrdtree[hostInstance][pluginName] || {};
					rrdtree[hostInstance][pluginName][pluginInstance] = rrdtree[hostInstance][pluginName][pluginInstance] || {};

					for (let kentr of jentr.entries) {
						const m = kentr.name.match(/^([^-]+)(?:-(.+))?\.rrd$/);

						if (!m)
							continue;

						const dataType = m[1];
						const dataInstance = m[2] || '';

						rrdtree[hostInstance][pluginName][pluginInstance][dataType] = rrdtree[hostInstance][pluginName][pluginInstance][dataType] || [];
						rrdtree[hostInstance][pluginName][pluginInstance][dataType].push(dataInstance);
					}
				}
			}
		}, this));
	},

	hostInstances() {
		return Object.keys(rrdtree).sort();
	},

	pluginNames(hostInstance) {
		return Object.keys(rrdtree[hostInstance] || {}).sort();
	},

	pluginInstances(hostInstance, pluginName) {
		return Object.keys((rrdtree[hostInstance] || {})[pluginName] || {}).sort(function(a, b) {
			const x = a.match(/^(\d+)\b/);
			const y = b.match(/^(\d+)\b/);

			if (!x != !y)
				return !x - !y;
			else if (x && y && x[0] != y[0])
				return +x[0] - +y[0];
			else
				return a < b ? -1 : a > b ? 1 : 0;
		});
	},

	dataTypes(hostInstance, pluginName, pluginInstance) {
		return Object.keys(((rrdtree[hostInstance] || {})[pluginName] || {})[pluginInstance] || {}).sort();
	},

	dataInstances(hostInstance, pluginName, pluginInstance, dataType) {
		return ((((rrdtree[hostInstance] || {})[pluginName] || {})[pluginInstance] || {})[dataType] || []).sort();
	},

	pluginTitle(pluginName) {
		const def = graphdefs[pluginName];
		return (def ? def.title : null) || pluginName;
	},

	hasDefinition(pluginName) {
		return (graphdefs[pluginName] != null);
	},

	hasInstanceDetails(hostInstance, pluginName, pluginInstance) {
		const def = graphdefs[pluginName];

		if (!def || typeof(def.rrdargs) != 'function')
			return false;

		const optlist = this._forcelol(def.rrdargs(this, hostInstance, pluginName, pluginInstance, null, false));

		for (let opt of optlist)
			if (opt.detail)
				return true;

		return false;
	},

	_mkpath(host, plugin, plugin_instance, dtype, data_instance) {
		let path = host + '/' + plugin;

		if (plugin_instance != null && plugin_instance != '')
			path += '-' + plugin_instance;

		path += '/' + dtype;

		if (data_instance != null && data_instance != '')
			path += '-' + data_instance;

		return path;
	},

	mkrrdpath(/* ... */) {
		return '%s/%s.rrd'.format(
			this.opts.rrdpath,
			this._mkpath.apply(this, arguments)
		).replace(/[\\:]/g, '\\$&');
	},

	_forcelol(list) {
		return L.isObject(list[0]) ? list : [ list ];
	},

	_getSources(opts, host, plugin, plugin_instance, dtype) {
		const diagrams = [];
		const sources = [];
		random.seed(sfh([
			plugin,
			plugin_instance || '',
			dtype || ''
		].join('.')));

		const data_types = dtype ? [ dtype ] : (opts.data.types || []).slice();

		if (!dtype && !opts.data.types) {
			if (L.isObject(opts.data.instances))
				data_types.push(...Object.keys(opts.data.instances));
			else if (L.isObject(opts.data.sources))
				data_types.push(...Object.keys(opts.data.sources));
		}

		for (let dt of data_types) {
			let data_instances;

			if (!opts.per_instance) {
				if (L.isObject(opts.data.instances) &&
					Array.isArray(opts.data.instances[dt]))
					data_instances = opts.data.instances[dt];
				else
					data_instances = this.dataInstances(
						host, plugin, plugin_instance, dt
					);
			}

			if (!Array.isArray(data_instances) || data_instances.length == 0)
				data_instances = [ '' ];

			for (let di of data_instances) {
				let dname = dt;

				if (di.length)
					dname += '_' + di;

				let data_sources = [ 'value' ];

				if (L.isObject(opts.data.sources)) {
					if (Array.isArray(opts.data.sources[dname]))
						data_sources = opts.data.sources[dname];
					else if (Array.isArray(opts.data.sources[dt]))
						data_sources = opts.data.sources[dt];
				}

				for (let ds of data_sources) {
					const dsname = dt + '_' + di.replace(/\W/g, '_') + '_' + ds;
					const altname = dt + '__' + ds;

					let dopts = {};

					if (L.isObject(opts.data.options)) {
						if (L.isObject(opts.data.options[dsname]))
							dopts = opts.data.options[dsname];
						else if (L.isObject(opts.data.options[altname]))
							dopts = opts.data.options[altname];
						else if (L.isObject(opts.data.options[dname]))
							dopts = opts.data.options[dname];
						else if (L.isObject(opts.data.options[dt]))
							dopts = opts.data.options[dt];
					}
					const source = {
						rrd: dopts.rrd || this.mkrrdpath(
							host, plugin, plugin_instance, dt, di
						),
						ds: ds,
						type: dt,
						instance: di,
						index: sources.length + 1,
						color: dopts.color || colors.asString(colors.random()),
						flip: dopts.flip || false,
						total: dopts.total || false,
						overlay: dopts.overlay || false,
						transform_rpn: dopts.transform_rpn || '0,+',
						noarea: dopts.noarea || false,
						noavg: dopts.noavg || false,
						title: dopts.title || null,
						weight: dopts.weight ||
						(dopts.negweight ? -+di : null) ||
						(dopts.posweight ? +di : null) || null
					};

					source.title = i18n.ds(host, source);
					sources.push(source);
				}
			}
		}

		if (sources.length == 0)
			return diagrams;

				let instances = [ '' ];

				if (opts.per_instance)
					instances = this.dataInstances(
						host, plugin, plugin_instance, sources[0].type
					);

				for (let inst of instances) {
					const diagram_sources = sources.map(source => {
						const copy = Object.assign({}, source);

						if (opts.per_instance) {
							copy.instance = inst;
							copy.rrd = this.mkrrdpath(
								host, plugin, plugin_instance, copy.type, inst
							);
							copy.title = i18n.ds(host, copy);
						}

						return copy;
					});

					diagram_sources.sort((a, b) => {
						const x = a.weight || a.index || 0;
						const y = b.weight || b.index || 0;

						return +x - +y;
					});

					if (opts.ordercolor) {
						for (let j = 0; j < diagram_sources.length; j++)
							diagram_sources[j].color = colors.defined(j);
					}

					diagrams.push({
						title: i18n.title(
							host, plugin, plugin_instance,
						sources[0].type, inst, opts.title
						),
						vlabel: i18n.label(
							host, plugin, plugin_instance,
						 sources[0].type, inst, opts.vlabel
						),
						y_min: opts.y_min,
						y_max: opts.y_max,
						logarithmic: Array.isArray(opts.rrdopts) &&
						opts.rrdopts.includes('--logarithmic'),
						sources: diagram_sources
					});
				}
		return diagrams;
	},

	_xportArgs(diagram) {
		const args = [];

		diagram.sources.forEach((source, index) => {
			const name = 's' + index;

			args.push(
				'DEF:%s=%s:%s:AVERAGE'.format(
					name, source.rrd, source.ds || 'value'
				),
			 'XPORT:%s:%s'.format(name, source.title || name)
			);
		});

		return args;
	},

	_xport(diagram, timespan) {
		const end = Math.floor(Date.now() / 1000) - 15;
		const span = Number(timespan || this.opts.timespan);
		console.log('RRD XPORT:', diagram, timespan);
		const units = {
			hour: 3600,
			day: 86400,
			week: 604800,
			month: 2592000,
			year: 31536000
		};

		const match = /^(\d+)(hour|day|week|month|year)$/.exec(
			String(timespan || this.opts.timespan)
		);

		const seconds = match
		? Number(match[1]) * units[match[2]]
		: span;

		if (!Number.isFinite(seconds) || seconds <= 0)
			return Promise.reject(new Error('Invalid timespan'));

		const step = Math.max(60, Math.ceil(seconds / 600 / 60) * 60);

		return callRrdXport(
			Math.floor(end - seconds),
							end,
					  step,
					  this._xportArgs(diagram)
		);
	},

	_parseXport(json) {
		return {
			start: json.start,
			step: json.step,
			series: json.legend.map((label, index) => ({
				values: json.data.map(row => row[index])
			}))
		};
	},

	_preparePlot(diagram, data) {
		function transform(value, rpn) {
			if (value == null || !Number.isFinite(value))
				return null;

			if (!rpn || rpn == '0,+')
				return value;

			const match = /^([0-9.]+),([*/])$/.exec(rpn);

			if (!match)
				throw new Error('Unsupported RPN transformation: ' + rpn);

			const factor = Number(match[1]);

			if (match[2] == '*')
				return value * factor;

			return factor != 0 ? value / factor : null;
		}

		const series = diagram.sources.map((source, index) => {
			const values = data.series[index].values.map(value =>
			transform(value, source.transform_rpn)
			);

			const plotValues = diagram.logarithmic
			? values.map(value =>
			value != null && value > 0 ? Math.log10(value) : null
			)
			: values;

			return {
				label: source.title,
				color: source.color,
				values: values,
				plotValues: plotValues
			};
		});

		return {
			title: diagram.title,
			vlabel: diagram.vlabel,
			start: data.start,
			step: data.step,
			series: series
		};
	},

	render(plugin, plugin_instance, is_index, hostname, timespan, width, height, cache) {
		const plots = [];
		const def = graphdefs[plugin];

		if (def && typeof(def.rrdargs) == 'function') {
			const optlist = this._forcelol(
				def.rrdargs(this, hostname, plugin, plugin_instance, null, is_index)
			);

			for (let opt of optlist) {
				if (is_index && opt.detail)
					continue;

				const diagrams = this._getSources(
					opt, hostname, plugin, plugin_instance, null
				);

				for (let diagram of diagrams) {
					plots.push(
						this._xport(diagram, timespan).then(json =>
						this._preparePlot(
							diagram,
						this._parseXport(json)
						)
						)
					);
				}
			}
		}

		return Promise.all(plots);
	}
});
