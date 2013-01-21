var Db = require('mysql-activerecord'),
	phantom = require('phantom'),
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
			.order_by('add_time', 'desc')
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

		var extractKvResults = function(type, page, ph) {
			return page.evaluate((function() {
				var _results = [];
				$('.s_res_obj_container').each(function() {
					var obj = {
						uid: '',
					};
					obj.url = $(this).find('.s_res_top_title_column a').attr('href');
					obj.price = $(this).find('.s_res_top_price_column').text()
					_results.push(obj);
				});
				return JSON.stringify(_results);
			}), function(results) {
				try {
					results = JSON.parse(results);
					var parsedResults = [];
					_.each(results, function(res, i) {
						var o = {
							url: res.url.replace(/\?nr=([0-9]+)\&search_key=([a-zA-Z0-9]+)/ig, ''),
							price: _.trim(res.price.match(/([0-9\s]+)/ig)[0].replace(/\s/ig, '').replace('\n','')),
							uid: res.url.match(/([0-9]+)\.html/ig),
							add_time: new Date(),
							type: type,
							site: 'kv'
						};
						if (o.uid.length > 0) {
							o.uid = o.uid[0].replace('.html','');
							parsedResults.push(o);
						}
					});
					handleResults(type, parsedResults, 'kv');
				}
				catch (err) {
				}
			});
		};

		var extractCityResults = function(type, window) {
			var results = [];
			window.$("#search_results_container .result_item").each(function() {
				var obj = {
					url: 'http://city24.ee' + window.$(this).find('.result_item_content .title a').attr('href').replace(/;jsessionid=([a-zA-Z0-9]+)\//ig, '/'),
					add_time: new Date(),
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
			var log = function(str) {
				console.log(new Date() + ' - ' + str);
			}
			phantom.create(function(ph) {
				return ph.createPage(function(page) {
					try {
						return page.open(url, function(status) {
							page.includeJs('https://ajax.googleapis.com/ajax/libs/jquery/1.9.0/jquery.min.js', function() {
								extractKvResults(type, page, ph);
								ph.exit();
							});
						});
					}
					catch (err) {
						log(err);
						ph.exit();
					}
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