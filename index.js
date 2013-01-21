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
			.order_by('add_time', 'asc')
			.limit(500)
			.get('objects', function(err, rows) {
				res.writeHead(200, { 'Content-Type': 'application/json'});
				res.end(JSON.stringify(rows, null, 2));
			})
	});

	server.listen(config.port);

	var scraper = function(bindNext) {
		var searchMatrix =['kv.maja', 'kv.korter', 'city24.maja', 'city24.korter'];
		var searchMatrixDone = [];

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
				searchMatrixDone.push(src + '.' + type);
				if (searchMatrix.length == searchMatrixDone.length) {
					if (bindNext) {
						setTimeout(scraper, _.random(300000, 420000));
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
			window.$('.s_res_obj_container').each(function() {
				var o = {
					url: window.$(this).find('.s_res_top_title_column a').attr('href').replace(/\?nr=([0-9]+)\&search_key=([a-zA-Z0-9]+)/ig, ''),
					price: _.trim(window.$(this).find('.s_res_top_price_column').text().match(/([0-9\s]+)/ig)[0].replace(/\s/ig, '').replace('\n','')),
					type: type,
					site: 'kv'
				};

				o.uid = o.url.match(/([0-9]+)\.html/ig);

				if (o.uid.length > 0) {
					o.uid = o.uid[0].replace('.html','');
					parsedResults.push(o);
				}
			});

			handleResults(type, parsedResults, 'kv');
		};

		var extractCityResults = function(type, window) {
			var results = [];
			window.$("#search_results_container .result_item").each(function() {
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
		}


		// KV.ee Uued majad Harjumaal
		kvSearch("maja", "http://www.kv.ee/?act=search.simple&deal_type=3&county=1&parish=0&energy_cert_val=0&price_min=&price_max=" + config.search.maja.maxHind + "&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl");
		
		// KV.ee Uued korterid Tallinnas
		kvSearch("korter", "http://www.kv.ee/?act=search.simple&deal_type=1&county=1&parish=421&county=1&parish=0&energy_cert_val=0&price_min=&price_max=" + config.search.maja.maxHind + "&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl&rooms_min=" + config.search.korter.minTube + "&rooms_max=&area_min=" + config.search.korter.minSuurus);

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