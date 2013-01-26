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

var log = function() {
	arguments = _.values(arguments);
	arguments.unshift(new Date().toUTCString() + ' --- ');
	console.log.apply(this, arguments);
};

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

		var searchMatrix =[
			'kv.maja',
			'kv.korter',
			'kv.korter-terrass',
			'kv.korter-rodu',
			'city24.maja',
			'city24.korter-rodu',
			'city24.korter-terrass',
			'ekspress.maja',
			'ekspress.korter-terrass',
			'ekspress.korter-rodu'
		];

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
					log('insert ' + obj.site + '.' + type + '.' + obj.uid + ' ... ' + (dupe ? 'already known' : 'new object!'));

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
				if (!res || !res.body) return;
				jsdom.env(res.body, ["http://code.jquery.com/jquery.js"], function(errors, window) {
					extractKvResults(type, window);
					window.close();
				});
			});
		};

		var city24Search = function(type, data) {
			request.post({ url: 'http://city24.ee/client/city24client', form: data }, function(err, res) {
				if (!res || !res.body) return;
				jsdom.env(res.body, ["http://code.jquery.com/jquery.js"], function(errors, window) {
					extractCityResults(type, window);
					window.close();
				});
			});
		};

		var ekspressKinnisvaraSearch = function(type, url) {
			request.get({ url: url }, function(err, res) {
				if (!res || !res.body) return;
				jsdom.env(res.body, ["http://code.jquery.com/jquery.js"], function(errors, window) {
					extractEkspressKinnisvaraResults(type, window);
					window.close();
				});
			});
		};

		var kvParishMap = {
			'1': 'Aegviidu vald',
            '2': 'Anija vald',
            '3': 'Harku vald',
            '4': 'Jõelähtme vald',
            '416': 'Keila',
            '5': 'Keila vald',
            '6': 'Kernu vald',
            '7': 'Kiili vald',
            '8': 'Kose vald',
            '9': 'Kuusalu vald',
            '10': 'Kõue vald',
            '417': 'Loksa',
            '11': 'Loksa vald',
            '418': 'Maardu',
            '12': 'Nissi vald',
            '13': 'Padise vald',
            '419': 'Paldiski',
            '14': 'Raasiku vald',
            '15': 'Rae vald',
            '16': 'Saku vald',
            '420': 'Saue',
            '17': 'Saue vald',
            '421': 'Tallinn',
            '18': 'Vasalemma vald',
            '19': 'Viimsi vald'
        }

		// KV.ee majad Harjumaal
		kvSearch('maja', 'http://www.kv.ee/?act=search.simple&deal_type=3&county=1&parish=0&energy_cert_val=0&price_min=&price_max=' + config.search.maja.maxHind + '&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl');
		
		// KV.ee korterid rõduga Tallinnas
		kvSearch('korter-rodu', 'http://www.kv.ee/?act=search.simple&deal_type=1&county=1&parish=421&county=1&parish=0&energy_cert_val=0&price_min=&price_max=' + config.search.korter.maxHind + '&price_type=1&keyword=rõdu&search=Otsi&recent=1&orderby=cdwl&rooms_min=' + config.search.korter.minTube + '&rooms_max=&area_min=' + config.search.korter.minSuurus);

		// KV.ee korterid terrassiga Tallinnas
		kvSearch('korter-terrass', 'http://www.kv.ee/?act=search.simple&deal_type=1&county=1&parish=421&county=1&parish=0&energy_cert_val=0&price_min=&price_max=' + config.search.korter.maxHind + '&price_type=1&keyword=terrass&search=Otsi&recent=1&orderby=cdwl&rooms_min=' + config.search.korter.minTube + '&rooms_max=&area_min=' + config.search.korter.minSuurus);

		// KV.ee majaosad Harjumaal
		kvSearch('majaosa', 'http://www.kv.ee/?act=search.simple&company_id=&broker_id=&recent=0&coords=&price_m2_min=0&price_m2_max=0&bid_objects=&years_default=20&deposite_in_percents_default=30&intress_default=3.5&agent=0age_size=100&deal_type=11&county=1&parish=0&energy_cert_val=0&price_min=&price_max=' + config.search.majaosa.maxHind + '&price_type=1&keyword=&floors_min=&floors_max=&area_total_min=' + config.search.majaosa.minSuurus + '&area_total_max=&area_ground_min=&area_ground_max=&search=Otsi&orderby=cdwl&recent=1');

		// EkspressKinnisvara korterid Tallinnas rõduga
		ekspressKinnisvaraSearch('korter-rodu', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=1&obj=0&t=1&m=1&lv=1&la=0&yp_a=' + config.search.korter.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.korter.minHind + '&h_k=' + config.search.korter.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=' + config.search.korter.minTube + '&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&Vk=1&q=&r6=1&otsi_bt.x=46&otsi_bt.y=8&fid=&mid=&__acform__reqid=');

		// EkspressKinnisvara korterid Tallinnas terrassiga
		ekspressKinnisvaraSearch('korter-terrass', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=1&obj=0&t=1&m=1&lv=1&la=0&yp_a=' + config.search.korter.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.korter.minHind + '&h_k=' + config.search.korter.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=' + config.search.korter.minTube + '&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&Vk=1&q=&te=1&otsi_bt.x=46&otsi_bt.y=8&fid=&mid=&__acform__reqid=');

		// EkspressKinnisvara majad Harjumaal
		ekspressKinnisvaraSearch('maja', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=2&obj=0&t=1&m=1&lv=0&la=0&yp_a=%27&yp_k=&ks_a=&ks_k=&l1=2&h_a=&h_k=' + config.search.maja.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=%27&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&q=&otsi_bt.x=38&otsi_bt.y=12&fid=&mid=&__acform__reqid=');

		// EkspressKinnisvara majaosad Harjumaal
		ekspressKinnisvaraSearch('majaosa', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=7&obj=0&t=1&m=1&lv=0&la=0&yp_a=' + config.search.majaosa.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=&h_k=' + config.search.majaosa.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&sa=1&q=&otsi_bt.x=39&otsi_bt.y=17&fid=&mid=&__acform__reqid=');

		// City24.ee majad Harjumaal
		city24Search('maja', {
			pageId: '4',
			objId: 'SearchObject',
			stateId: 'ShowResults',
			eventId: '',
			search_oldest: moment().subtract('days', 1).format("DD.MM.YYYY"),
			search_reo_type: 'HOUSE_HOUSE',
			search_trans: 'TRANSACTION_SALE',
			search_county: 'COUNTY_HARJUMAA',
			search_price1: config.search.maja.minHind,
			search_price2: config.search.maja.maxHind,
			search_size: 100
		});

		// City24.ee majaosad Harjumaal
		city24Search('majaosa', {
			pageId: '4',
			objId: 'SearchObject',
			stateId: 'ShowResults',
			eventId: '',
			search_oldest: moment().subtract('days', 1).format("DD.MM.YYYY"),
			search_reo_type: 'HOUSE_PART',
			search_trans: 'TRANSACTION_SALE',
			search_county: 'COUNTY_HARJUMAA',
			search_area1: config.search.majaosa.minSuurus,
			search_price1: config.search.majaosa.minHind,
			search_price2: config.search.majaosa.maxHind,
			search_size: 100
		});

		// City24.ee korterid Tallinnas
		city24Search('korter', {
			pageId: '4',
			objId: 'SearchObject',
			stateId: 'ShowResults',
			eventId: '',
			search_oldest: moment().subtract('days', 1).format("DD.MM.YYYY"),
			search_reo_type: 'REO_APPARTMENT',
			search_trans: 'TRANSACTION_SALE',
			search_county: 'COUNTY_HARJUMAA',
			search_price1: config.search.korter.minHind,
			search_price2: config.search.korter.maxHind,
			search_size: 100,
			search_area1: config.search.korter.minSuurus,
			search_rooms1: config.search.korter.minTube,
			search_is_last_floor: true,
			search_has_elevator: true,
			search_has_sauna: true,
			search_has_balcony: true
		});

	};

	scraper((process.env.NODE_ENV && process.env.NODE_ENV == 'production'));

});