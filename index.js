var Db = require('mysql-activerecord'),
	request = require('request'),
	moment = require('moment'),
	jsdom = require('jsdom'),
	url = require('url'),
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
		var reqQuery = url.parse(req.url);
		db
			.order_by('add_time desc')
			.limit(1000);

		var reqUrl = _.compact(url.parse(req.url).pathname.split('/'));
		
		if (typeof reqUrl[1] != 'undefined') {
			db.where('type', reqUrl[1]);
		}

		db
			.get('objects', function(err, rows) {
				if (req.url.match(/html/)) {
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Query': db._last_query() });
					var markup = '<!doctype html><html><head><title>KV</title><script src="//cdnjs.cloudflare.com/ajax/libs/moment.js/1.7.2/moment.min.js"></script></head><body><ol>'
					_.each(rows, function(row) {
						markup += '<li value="' + row.id + '"><a href="' + row.url + '">' + row.type + ' (€' + row.price + ')</a> <small><script>document.write(moment("' + row.add_time + '").fromNow());</script></small></li>';
					});
					markup += '</ol></body></html>';
					res.end(markup);
				}
				else {
					res.writeHead(200, { 'Content-Type': 'application/json', 'Query': db._last_query() });
					res.end(JSON.stringify(rows, null, 2));
				}
			})
	});

	server.listen(config.port);

	scraper((process.env.NODE_ENV && process.env.NODE_ENV == 'production'));

});

var scrapeMore = function() {
	scraper((process.env.NODE_ENV && process.env.NODE_ENV == 'production'));
}

var scraper = function(bindNext) {

	var searchMatrix =[
		'kv.maja',
		'kv.maamaja',
		'kv.korter',
		'kv.korter-terrass',
		'kv.korter-rodu',
		'city24.maja',
		'city24.maamaja',
		'city24.korter-rodu',
		'city24.korter-terrass',
		'ekspress.maja',
		'ekspress.maamaja',
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
					if (err) log(err);
					else cb((typeof rows.length != 'undefined' ? (rows.length > 0) : true));
				});
		};

		var onFinish = function() {
			searchMatrixDone[src + '.' + type] = true;
			if (searchMatrix.length == _.keys(searchMatrixDone).length) {
				if (bindNext) {
					var x = 1000;
					setTimeout(scrapeMore, _.random(300 * x, 420 * x));
					db.disconnect();
					db = new Db.Adapter(config.db);
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
					obj.add_time = new moment().format("YYYY-MM-DD HH:mm:ss");
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

	var buildTimeout = (function() {
		var pointer = 0;
		return function() {
			pointer = pointer + 3421;
			return pointer;
		}
	})();

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

    /* ----------------------------------------------- */

	// KV.ee majaosad Saku vallas
	setTimeout(function() {
		kvSearch('majaosa', 'http://www.kv.ee/?act=search.simple&company_id=&broker_id=&recent=0&coords=&price_m2_min=0&price_m2_max=0&bid_objects=&years_default=20&deposite_in_percents_default=30&intress_default=3.5&agent=0age_size=100&deal_type=11&county=1&parish=16&energy_cert_val=0&price_min=' + config.search.majaosa.minHind + '&price_max=' + config.search.majaosa.maxHind + '&price_type=1&keyword=&floors_min=&floors_max=&area_total_min=' + config.search.majaosa.minSuurus + '&area_total_max=&area_ground_min=&area_ground_max=&search=Otsi&orderby=cdwl&recent=1');
	}, buildTimeout());

	// KV.ee majaosad Viimsi vallas
	setTimeout(function() {
		kvSearch('majaosa', 'http://www.kv.ee/?act=search.simple&company_id=&broker_id=&recent=0&coords=&price_m2_min=0&price_m2_max=0&bid_objects=&years_default=20&deposite_in_percents_default=30&intress_default=3.5&agent=0age_size=100&deal_type=11&county=1&parish=19&energy_cert_val=0&price_min=' + config.search.majaosa.minHind + '&price_max=' + config.search.majaosa.maxHind + '&price_type=1&keyword=&floors_min=&floors_max=&area_total_min=' + config.search.majaosa.minSuurus + '&area_total_max=&area_ground_min=&area_ground_max=&search=Otsi&orderby=cdwl&recent=1');
	}, buildTimeout());

	// KV.ee majaosad Harku vallas
	setTimeout(function() {
		kvSearch('majaosa', 'http://www.kv.ee/?act=search.simple&company_id=&broker_id=&recent=0&coords=&price_m2_min=0&price_m2_max=0&bid_objects=&years_default=20&deposite_in_percents_default=30&intress_default=3.5&agent=0age_size=100&deal_type=11&county=1&parish=3&energy_cert_val=0&price_min=' + config.search.majaosa.minHind + '&price_max=' + config.search.majaosa.maxHind + '&price_type=1&keyword=&floors_min=&floors_max=&area_total_min=' + config.search.majaosa.minSuurus + '&area_total_max=&area_ground_min=&area_ground_max=&search=Otsi&orderby=cdwl&recent=1');
	}, buildTimeout());

	// EkspressKinnisvara majaosad Viimsi vallas
	setTimeout(function() {
		ekspressKinnisvaraSearch('majaosa', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=7&obj=0&t=1&m=1&lv=63&la=0&yp_a=' + config.search.majaosa.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.majaosa.minHind + '&pk=1&h_k=' + config.search.majaosa.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&sa=1&q=&otsi_bt.x=39&otsi_bt.y=17&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// EkspressKinnisvara majaosad Saku vallas
	setTimeout(function() {
		ekspressKinnisvaraSearch('majaosa', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=7&obj=0&t=1&m=1&lv=60&la=0&yp_a=' + config.search.majaosa.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.majaosa.minHind + '&pk=1&h_k=' + config.search.majaosa.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&sa=1&q=&otsi_bt.x=39&otsi_bt.y=17&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// EkspressKinnisvara majaosad Harku vallas
	setTimeout(function() {
		ekspressKinnisvaraSearch('majaosa', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=7&obj=0&t=1&m=1&lv=48&la=0&yp_a=' + config.search.majaosa.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.majaosa.minHind + '&pk=1&h_k=' + config.search.majaosa.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&sa=1&q=&otsi_bt.x=39&otsi_bt.y=17&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// City24.ee majaosad Viimsi vallas
	setTimeout(function() {
		city24Search('majaosa', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_PART', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_city: 'CITY_V_VIIMSI', search_area1: config.search.majaosa.minSuurus, search_price1: config.search.majaosa.minHind, search_price2: config.search.majaosa.maxHind, search_size: 100 });
	}, buildTimeout());

	// City24.ee majaosad Saku vallas
	setTimeout(function() {
		city24Search('majaosa', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_PART', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_city: 'CITY_V_SAKU', search_area1: config.search.majaosa.minSuurus, search_price1: config.search.majaosa.minHind, search_price2: config.search.majaosa.maxHind, search_size: 100 });
	}, buildTimeout());

	// City24.ee majaosad Harku vallas
	setTimeout(function() {
		city24Search('majaosa', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_PART', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_city: 'CITY_V_HARKU', search_area1: config.search.majaosa.minSuurus, search_price1: config.search.majaosa.minHind, search_price2: config.search.majaosa.maxHind, search_size: 100 });
	}, buildTimeout());


	/* -------------------------------------------------- */


	// KV.ee majad Saku vallas
	kvSearch('maja', 'http://www.kv.ee/?act=search.simple&deal_type=3&county=1&parish=16&energy_cert_val=0&price_min=' + config.search.maja.minHind + '&price_max=' + config.search.maja.maxHind + '&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl');

	// KV.ee majad Viimsi vallas
	setTimeout(function() {
		kvSearch('maja', 'http://www.kv.ee/?act=search.simple&deal_type=3&county=1&parish=19&energy_cert_val=0&price_min=' + config.search.maja.minHind + '&price_max=' + config.search.maja.maxHind + '&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl');
	}, buildTimeout());

	// KV.ee majad Harku vallas
	setTimeout(function() {
		kvSearch('maja', 'http://www.kv.ee/?act=search.simple&deal_type=3&county=1&parish=3&energy_cert_val=0&price_min=' + config.search.maja.minHind + '&price_max=' + config.search.maja.maxHind + '&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl');
	}, buildTimeout());
	
	// EkspressKinnisvara majad Viimsi vallas
	setTimeout(function() {
		ekspressKinnisvaraSearch('maja', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=2&obj=0&t=1&m=1&lv=63&la=0&yp_a=%27&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.maja.minHind + '&h_k=' + config.search.maja.maxHind + '&pk=1&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=%27&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&q=&otsi_bt.x=38&otsi_bt.y=12&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// EkspressKinnisvara majad Saku vallas
	setTimeout(function() {
		ekspressKinnisvaraSearch('maja', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=2&obj=0&t=1&m=1&lv=60&la=0&yp_a=%27&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.maja.minHind + '&h_k=' + config.search.maja.maxHind + '&pk=1&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=%27&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&q=&otsi_bt.x=38&otsi_bt.y=12&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// EkspressKinnisvara majad Harku vallas
	setTimeout(function() {
		ekspressKinnisvaraSearch('maja', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=2&obj=0&t=1&m=1&lv=48&la=0&yp_a=%27&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.maja.minHind + '&h_k=' + config.search.maja.maxHind + '&pk=1&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=%27&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&q=&otsi_bt.x=38&otsi_bt.y=12&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// City24.ee majad Viimsi vallas
	city24Search('maja', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_HOUSE', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_city: 'CITY_V_VIIMSI', search_price1: config.search.maja.minHind, search_price2: config.search.maja.maxHind, search_size: 100 });

	// City24.ee majad Saku vallas
	setTimeout(function() {
		city24Search('maja', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_HOUSE', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_city: 'CITY_V_SAKU', search_price1: config.search.maja.minHind, search_price2: config.search.maja.maxHind, search_size: 100 });
	}, buildTimeout());

	// City24.ee majad Harku vallas
	setTimeout(function() {
		city24Search('maja', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_HOUSE', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_city: 'CITY_V_HARKU', search_price1: config.search.maja.minHind, search_price2: config.search.maja.maxHind, search_size: 100 });
	}, buildTimeout());


	/* ------------------------------------------ */


	// KV.ee maamajad
	// setTimeout(function() {
	// 	kvSearch('maamaja', 'http://www.kv.ee/?act=search.simple&deal_type=3&county=0&parish=0&energy_cert_val=0&price_min=' + config.search.maamaja.minHind + '&price_max=' + config.search.maamaja.maxHind + '&price_type=1&keyword=&search=Otsi&recent=1&orderby=cdwl');
	// }, buildTimeout());

	// // City24.ee maamajad
	// setTimeout(function() {
	// 	city24Search('maamaja', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'HOUSE_HOUSE', search_trans: 'TRANSACTION_SALE', search_price1: config.search.maamaja.minHind, search_price2: config.search.maamaja.maxHind, search_size: 100 });
	// }, buildTimeout());

	// // EkspressKinnisvara maamajad
	// setTimeout(function() {
	// 	ekspressKinnisvaraSearch('maamaja', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=2&obj=1&t=1&m=0&lv=0&la=0&yp_a=&yp_k=&ks_a=800&ks_k=&l1=2&h_a=' + config.search.maamaja.minHind + '&h_k=' + config.search.maamaja.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=&ta_k=&kv_a=&kv_k=&om=4&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&pk=1&q=&otsi_bt.x=45&otsi_bt.y=10&fid=&mid=&__acform__reqid=');
	// }, buildTimeout());


	/* ------------------------------------------ */


	// KV.ee korterid rõduga Tallinnas
	setTimeout(function() {
		kvSearch('korter-rodu', 'http://www.kv.ee/?act=search.simple&deal_type=1&county=1&parish=421&county=1&parish=0&energy_cert_val=0&price_min=' + config.search.korter.minHind + '&price_max=' + config.search.korter.maxHind + '&price_type=1&keyword=rõdu&search=Otsi&recent=1&orderby=cdwl&rooms_min=' + config.search.korter.minTube + '&rooms_max=&area_min=' + config.search.korter.minSuurus);
	}, buildTimeout())

	// KV.ee korterid terrassiga Tallinnas
	setTimeout(function() {
		kvSearch('korter-terrass', 'http://www.kv.ee/?act=search.simple&deal_type=1&county=1&parish=421&county=1&parish=0&energy_cert_val=0&price_min=' + config.search.korter.minHind + '&price_max=' + config.search.korter.maxHind + '&price_type=1&keyword=terrass&search=Otsi&recent=1&orderby=cdwl&rooms_min=' + config.search.korter.minTube + '&rooms_max=&area_min=' + config.search.korter.minSuurus);
	}, buildTimeout());

	// EkspressKinnisvara korterid Tallinnas rõduga
	ekspressKinnisvaraSearch('korter-rodu', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=1&obj=0&t=1&m=1&lv=1&la=0&yp_a=' + config.search.korter.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.korter.minHind + '&pk=1&h_k=' + config.search.korter.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=' + config.search.korter.minTube + '&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&Vk=1&q=&r6=1&otsi_bt.x=46&otsi_bt.y=8&fid=&mid=&__acform__reqid=');

	// EkspressKinnisvara korterid Tallinnas terrassiga
	setTimeout(function() {
		ekspressKinnisvaraSearch('korter-terrass', 'http://www.ekspresskinnisvara.ee/est/otsing/?ot=1&obj=0&t=1&m=1&lv=1&la=0&yp_a=' + config.search.korter.minSuurus + '&yp_k=&ks_a=&ks_k=&l1=2&h_a=' + config.search.korter.minHind + '&pk=1&h_k=' + config.search.korter.maxHind + '&l2=2&h2_a=&h2_k=&ea_a=&ea_k=&ta_a=' + config.search.korter.minTube + '&ta_k=&kv_a=&kv_k=&om=0&sk=0&my=0&m6=0&mt=0&lv2=0&ky=0&sort=U&Vk=1&q=&te=1&otsi_bt.x=46&otsi_bt.y=8&fid=&mid=&__acform__reqid=');
	}, buildTimeout());

	// City24.ee korterid rõduga viimasel korrusel Tallinnas
	setTimeout(function() {
		city24Search('korter-terrass', { pageId: '4', objId: 'SearchObject', stateId: 'ShowResults', eventId: '', search_oldest: new moment().subtract('days', 4).format("DD.MM.YYYY"), search_reo_type: 'REO_APPARTMENT', search_trans: 'TRANSACTION_SALE', search_county: 'COUNTY_HARJUMAA', search_price1: config.search.korter.minHind, search_price2: config.search.korter.maxHind, search_size: 100, search_area1: config.search.korter.minSuurus, search_rooms1: config.search.korter.minTube, search_is_last_floor: true, search_has_elevator: true, search_has_sauna: true, search_has_balcony: true });
	}, buildTimeout());


};