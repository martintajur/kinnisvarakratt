var Db = require('mysql-activerecord'),
	request = require('request'),
	moment = require('moment'),
	jsdom = require('jsdom'),
	_ = require('underscore'),
	http = require('http'),
	config = require(__dirname + '/config.json');

var db = new Db.Adapter(config.db);

_.str = require('underscore.string');
_.mixin(_.str.exports());

db.query('SELECT * from objects LIMIT 1', function(err, rows, fields) {

	if (err) throw err;

	var server = http.createServer(function(req, res) {
		db
			.order_by('add_time desc')
			.limit(500)
			.get('objects', function(err, rows) {
				res.writeHead(200, { 'Content-Type': 'application/json', 'Query': db._last_query() });
				res.end(JSON.stringify(rows, null, 2));
			})
	});

	server.listen(config.port);

	var scraper = function(bindNext) {
		var searchMatrix =['kv.maja', 'kv.korter', 'city24.maja', 'city24.korter', 'ekspress.maja', 'ekspress.korter'];
		var searchMatrixDone = {};

		var handleResults = function(type, res, src) {

			var checkDuplicate = function(uid, cb) {
				db
					.where('uid', uid)
					.where('site', src)
					.get('objects', function(err, rows) {
						cb(rows.length > 0);
					});
			};

			var onFinish = function() {
				searchMatrixDone[src + '.' + type] = true;
				if (searchMatrix.length == _.keys(searchMatrixDone).length) {
					if (bindNext) {
						var x = 1000;
						setTimeout(function() {
							scraper((process.env.NODE_ENV && process.env.NODE_ENV == 'production'));
						}, _.random(300 * x, 420 * x));
					}
					else {
						process.exit();
					}
				}
			}

			var objectsToComplete = res.length;

			_.each(res, function(obj) {
				checkDuplicate(obj.uid, function(dupe) {
					objectsToComplete--;
					console.log('insert ' + obj.site + '.' + obj.uid + ' ... ' + dupe);

					if (!dupe) {
						obj.add_time = moment().format("YYYY-MM-DD HH:mm:ss");
						db.insert('objects', obj, function() {

							if (objectsToComplete == 0) onFinish();
						});
					}
					else {
						if (objectsToComplete == 0) onFinish();
					}
				})
			})

		}

		var extractKvResults = function(type, window) {
			var parsedResults = [];
			if (!window.$) return;
			window.$('.s_res_obj_container').each(function() {
				if (!window.$) return;
				var o = {
					url: window.$(this).find('.s_res_top_title_column a').attr('href').replace(/\?nr=([0-9]+)\&search_key=([a-zA-Z0-9]+)/ig, ''),
					price: _.trim(window.$(this).find('.s_res_top_price_column').text().match(/([0-9\s]+)/ig)[0].replace(/\s/ig, '').replace('\n','')),
					type: type,
					site: 'kv'
				};

				o.uid = o.url.match(/([0-9]+)\.html/ig);

				if (_.isArray(o.uid) && o.uid.length > 0) {
					o.uid = o.uid[0].replace('.html','');
					parsedResults.push(o);
				}
			});

			handleResults(type, parsedResults, 'kv');
		};

		var extractCityResults = function(type, window) {
			var results = [];
			if (!window.$) return;
			window.$("#search_results_container .result_item").each(function() {
				if (!window.$) return;
				var obj = {
					url: 'http://city24.ee' + window.$(this).find('.result_item_content .title a').attr('href').replace(/;jsessionid=([a-zA-Z0-9]+)\//ig, '/'),
					type: type,
					site: 'city24'
				}
				obj.uid = obj.url.split('/').pop();
				obj.price = window.$(this).find('.result_item_content .price h1').text().match(/([0-9\s]+)/ig);
				if (obj.price.length > 0) {
					obj.price = _.trim(obj.price[0].replace(' ', '').replace('\n',''));
				}
				else {
					obj.price = '0';
				}
				results.push(obj);
			});
			handleResults(type, results, 'city24');
		};

		var extractEkspressKinnisvaraResults = function(type, window) {
			var results = [];
			if (!window.$) return;
			window.$("#otsingutulemus tr.tr").each(function() {
				if (!window.$) return;
				var obj = {
					url: window.$(this).find('a.st').attr('href'),
					type: type,
					site: 'ekspress'
				}
				obj.uid = obj.url.split('?id=').pop();
				obj.price = window.$(this).find('.hind').text().match(/([0-9\s]+)/ig);
				if (obj.price.length > 0) {
					obj.price = _.trim(obj.price[0].replace(' ', '').replace('\n',''));
				}
				else {
					obj.price = '0';
				}
				results.push(obj);
			});
			handleResults(type, results, 'ekspress');
		}

		var kvSearch = function(type, url) {
			request.get({ url: url }, function(err, res) {
				if (!res || !res.body) throw new Error('response is empty');
				jsdom.env(res.body, ["http://code.jquery.com/jquery.js"], function(errors, window) {
					extractKvResults(type, window);
					window.close();
				});
			});
		};

		var city24Search = function(type, data) {
			request.post({ url: 'http://city24.ee/client/city24client', form: data }, function(err, res) {
				if (!res || !res.body) throw new Error('response is empty');
				jsdom.env(res.body, ["http://code.jquery.com/jquery.js"], function(errors, window) {
					extractCityResults(type, window);
					window.close();
				});
			});
		};

		var ekspressKinnisvaraSearch = function(type, data) {
			request.get({ url: url }, function(err, res) {
				if (!res || !res.body) throw new Error('response is empty');
				jsdom.env(res.body, ["http://code.jquery.com/jquery.js"], function(errors, window) {
					extractEkspressKinnisvaraResults(type, window);
					window.close();
				});
			});
		};

		// KV.ee Uued majad Harjumaal
		kvSearch("maja", "http://www.kv.ee/?act=search.simple&deal_type=3&county=1&parish=0&energy_cert_val=0&price_min=&price_max=" + config.search.maja.maxHind + "&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl");
		
		// KV.ee Uued korterid Tallinnas
		kvSearch("korter", "http://www.kv.ee/?act=search.simple&deal_type=1&county=1&parish=421&county=1&parish=0&energy_cert_val=0&price_min=&price_max=" + config.search.maja.maxHind + "&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl&rooms_min=" + config.search.korter.minTube + "&rooms_max=&area_min=" + config.search.korter.minSuurus);

		// EkspressKinnisvara Uued korterid Tallinnas
		ekspressKinnisvaraSearch("korter", "http://www.ekspresskinnisvara.ee/est/otsing/?ot=1&obj=0&t=1&m=1&lv=1&la=0&yp_a=" + config.search.korter.minSuurus + "&yp_k=&ks_a=&ks_k=&l1=2&h_a=&h_k=" + config.search.maja.maxHind + "&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=" + config.search.korter.minTube + "&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&Vk=1&q=&otsi_bt.x=46&otsi_bt.y=8&fid=&mid=&__acform__reqid=");

		// EkspressKinnisvara Uued korterid Tallinnas
		ekspressKinnisvaraSearch("maja", "http://www.ekspresskinnisvara.ee/est/otsing/?ot=2&obj=0&t=1&m=1&lv=0&la=0&yp_a=%27&yp_k=&ks_a=&ks_k=&l1=2&h_a=&h_k=" + config.search.maja.maxHind + "&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=%27&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&q=&otsi_bt.x=38&otsi_bt.y=12&fid=&mid=&__acform__reqid=");

		// City24.ee Uued majad Harjumaal
		city24Search('maja', {
			pageId: '4',
			objId: 'SearchObject',
			stateId: 'ShowResults',
			eventId: '',
			search_oldest: moment().subtract('days', 1).format("DD.MM.YYYY"),
			search_reo_type: 'HOUSE_HOUSE',
			search_trans: 'TRANSACTION_SALE',
			search_county: 'COUNTY_HARJUMAA',
			search_price2: config.search.maja.maxHind,
			search_size: 100
		});

		// City24.ee Uued korterid Tallinnas
		city24Search('korter', {
			pageId: '4',
			objId: 'SearchObject',
			stateId: 'ShowResults',
			eventId: '',
			search_oldest: moment().subtract('days', 1).format("DD.MM.YYYY"),
			search_reo_type: 'REO_APPARTMENT',
			search_trans: 'TRANSACTION_SALE',
			search_county: 'COUNTY_HARJUMAA',
			search_price2: config.search.korter.maxHind,
			search_size: 100,
			search_area1: config.search.korter.minSuurus,
			search_rooms1: config.search.korter.minTube
		});

	};

	scraper((process.env.NODE_ENV && process.env.NODE_ENV == 'production'));

});