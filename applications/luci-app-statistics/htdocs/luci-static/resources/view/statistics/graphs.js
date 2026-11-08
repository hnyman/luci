'use strict';
'require view';
'require dom';
'require poll';
'require ui';
'require uci';
'require luci-plot as plot';
'require statistics.rrdtool as rrdtool';

let pollFn = null;
let activePlugin = null;
let activeInstance = null;

return view.extend({
	load() {
		return rrdtool.load();
	},

	renderPlot(diagram) {
		const target = E('div', {
			'style': 'width:100%'
		});

		const entries = Array.from(
			{ length: diagram.series[0]?.plotValues.length || 0 },
			(_, i) => {
				const entry = {
					timestamp: diagram.start + i * diagram.step
				};

				diagram.series.forEach((series, j) => {
					entry['s' + j] = series.plotValues[i];
				});

				return entry;
			}
		);

		plot.render(target, entries, {
			x: {
				type: 'time',
				key: 'timestamp'
			},
			series: diagram.series.map((series, j) => ({
				key: 's' + j,
				label: series.label,
				color: series.color
			}))
		});

		return target;
	},

	updatePluginTab(host, span, time, ev) {
		const container = ev.target;
		const width = Math.max(200, container.offsetWidth - 100);
		const plugin = ev.detail.tab;
		const render_instances = [];
		const plugin_instances = rrdtool.pluginInstances(host.value, plugin);
		const cache = {};

		activePlugin = plugin;

		dom.content(container, [
			E('p', {}, [
				E('em', { 'class': 'spinning' }, [ _('Loading data…') ])
			])
		]);

		for (let i = 0; i < plugin_instances.length; i++) {
			if (rrdtool.hasInstanceDetails(host.value, plugin, plugin_instances[i])) {
				render_instances.push([
					plugin_instances[i],
					plugin_instances[i] ? '%s: %s'.format(rrdtool.pluginTitle(plugin), plugin_instances[i]) : rrdtool.pluginTitle(plugin)
				]);
			}
		}

		if (render_instances.length == 0 || render_instances.length > 1) {
			render_instances.unshift([
				'-',
				'%s: %s'.format(rrdtool.pluginTitle(plugin), _('Overview'))
			]);
		}

		Promise.all(render_instances.map(function(instance) {
			if (instance[0] == '-') {
				const tasks = [];

				for (let i = 0; i < plugin_instances.length; i++)
					tasks.push(rrdtool.render(plugin, plugin_instances[i], true, host.value, span.value, width, null, cache));

				return Promise.all(tasks).then(function(blobs) {
					return Array.prototype.concat.apply([], blobs);
				});
			}
			else {
				return rrdtool.render(plugin, instance[0], false, host.value, span.value, width, null, cache);
			}
		})).then((blobs) => {
			const multiple = blobs.length > 1;

			dom.content(container, E('div', {}, blobs.map((blobs, i) => {
				const plugin_instance = i ? render_instances[i][0] : plugin_instances.join('|');
				const title = render_instances[i][1];

				return E('div', {
					'class': 'center',
					'data-tab': multiple ? i : null,
					'data-tab-title': multiple ? title : null,
					'data-plugin': plugin,
					'data-plugin-instance': plugin_instance,
					'data-is-index': i || render_instances.length == 1 ? null : true,
					'cbi-tab-active'(ev) { activeInstance = ev.target.getAttribute('data-plugin-instance') }
					},blobs.map(diagram => this.renderPlot(diagram)));
			})));

			if (multiple)
				ui.tabs.initTabGroup(container.lastElementChild.childNodes);
			else
				activeInstance = plugin_instances.join('|');
		});
	},

	updateGraphs(host, span, time, container, ev) {
		const plugin_names = rrdtool.pluginNames(host.value);

		dom.content(container, null);

		if (container.hasAttribute('data-initialized')) {
			container.removeAttribute('data-initialized');
			container.parentNode.removeChild(container.previousElementSibling);
		}

		for (let i = 0; i < plugin_names.length; i++) {
			if (!rrdtool.hasDefinition(plugin_names[i]))
				continue;

			container.appendChild(E('div', {
				'data-tab': plugin_names[i],
				'data-tab-title': rrdtool.pluginTitle(plugin_names[i]),
				'cbi-tab-active': L.bind(this.updatePluginTab, this, host, span, time)
			}, [
				E('p', {}, [
					E('em', { 'class': 'spinning' }, [ _('Loading data…') ])
				])
			]));
		}

		ui.tabs.initTabGroup(container.childNodes);
	},

	refreshGraphs(host, span, time, container) {
		const div = document.querySelector(
			'[data-plugin="%s"][data-plugin-instance="%s"]'.format(
				activePlugin, activeInstance || ''
			)
		);

		if (!div)
			return Promise.resolve();

		const width = Math.max(200, container.offsetWidth - 100);
		const render_instances = (activeInstance || '').split(/\|/);

		return Promise.all(render_instances.map(render_instance =>
		rrdtool.render(
			activePlugin,
			render_instance || '',
			div.hasAttribute('data-is-index'),
					   host.value,
				 span.value,
				 width
		)
		)).then(results => {
			const diagrams = [].concat(...results);

			dom.content(div, diagrams.map(diagram => this.renderPlot(diagram)));
		});
	},

	togglePolling(host, span, time, container, ev) {
		const btn = ev.currentTarget;

		if (pollFn) {
			poll.remove(pollFn);
			pollFn = null;
		}

		if (time.value != '0') {
			pollFn = L.bind(this.refreshGraphs, this, host, span, time, container);
			poll.add(pollFn, +time.value);
		}
	},

	render() {
		const hosts = rrdtool.hostInstances();
		return hosts.length ? this.renderGraphs() : this.renderNoData();
	},

	renderNoData() {
		ui.showModal(_('No RRD data found'), [
			E('p', {}, _('There is no RRD data available yet to render graphs.')),
			E('p', {}, _('You need to configure <em>collectd</em> to gather data into <em>.rrd</em> files.')),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'cbi-button',
					'click'(ev) { location.href = 'collectd' }
				}, [ _('Set up collectd') ])
			])
		]);
	},

	renderGraphs() {
		const hostSel = E('select', { 'style': 'max-width:170px', 'data-name': 'host' }, rrdtool.hostInstances().map(function(host) {
			return E('option', {
				'selected': (rrdtool.opts.host == host) ? 'selected' : null
			}, [ host ])
		}));

		const spanSel = E('select', { 'style': 'max-width:170px', 'data-name': 'timespan' }, L.toArray(uci.get('luci_statistics', 'collectd_rrdtool', 'RRATimespans')).map(function(span) {
			return E('option', {
				'selected': (rrdtool.opts.timespan == span) ? 'selected' : null
			}, [ span ])
		}));

		const timeSel = E('select', { 'style': 'max-width:170px', 'data-name': 'refresh' }, [
			E('option', { 'value': 0 }, [ _('Do not refresh') ]),
			E('option', { 'value': 5 }, [ _('Every 5 seconds') ]),
			E('option', { 'value': 30 }, [ _('Every 30 seconds') ]),
			E('option', { 'value': 60 }, [ _('Every minute') ])
		]);

		const graphDiv = E('div', { 'data-name': 'graphs' });

		const view = E([], [
			E('h2', {}, [ _('Statistics') ]),
			E('div', {}, [
				E('p', { 'class': 'controls' }, [
					E('span', { 'class': 'nowrap' }, [
						hostSel,
						E('button', {
							'class': 'cbi-button cbi-button-apply',
							'click': ui.createHandlerFn(this, 'updateGraphs', hostSel, spanSel, timeSel, graphDiv, )
						}, [ _('Display Host »') ]),
					]),
					' ',
					E('span', { 'class': 'nowrap' }, [
						spanSel,
						E('button', {
							'class': 'cbi-button cbi-button-apply',
							'click': ui.createHandlerFn(this, 'updateGraphs', hostSel, spanSel, timeSel, graphDiv)
						}, [ _('Display timespan »') ]),
					]),
					' ',
					E('span', { 'class': 'nowrap' }, [
						timeSel,
						E('button', {
							'class': 'cbi-button cbi-button-apply',
							'click': ui.createHandlerFn(this, 'togglePolling', hostSel, spanSel, timeSel, graphDiv)
						}, [ _('Apply interval »') ])
					])
				]),
				E('hr'),
				graphDiv
			])
		]);

		requestAnimationFrame(L.bind(this.updateGraphs, this, hostSel, spanSel, timeSel, graphDiv));

		let resizeTimeout;
		const rgCallback = L.bind(this.refreshGraphs, this, hostSel, spanSel, timeSel, graphDiv);
		addEventListener('resize', function() { clearTimeout(resizeTimeout); resizeTimeout = setTimeout(rgCallback, 250); });

		return view;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
