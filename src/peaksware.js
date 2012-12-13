//  ===========================================================================
/**
* @fileoverview JavaScript for the Peaksware JS Quiz.
* @author Scott Shattuck (ss)
* @copyright 2012 Scott Shattuck, All Rights Reserved.
*/
//  =========================================================================== 

/*jslint anon:true, nomen:true, plusplus:true, continue:true */
/*globals google, d3, $, Worker */

// Encapsulate file content as a closure to maintain privacy of internals.
(function(root) {

'use strict';

// Ensure proper binding of window or root context. Used for exporting.
var PQ,
	LOG;

//  --------------------------------------------------------------------------- 
//	Setup
//  --------------------------------------------------------------------------- 

// Trap uncaught exceptions that might try to slip past us.
if (window) {
	window.original_onerror = window.onerror;
	window.onerror = function(msg, url, line) {
		log('ERROR @ ' + url + '[' + (line || 0) + '] - ' + msg);
		return true;
	};
}

//  --------------------------------------------------------------------------- 
//  Private Support Functions
//  --------------------------------------------------------------------------- 

/**
 * Log to both the JavaScript console and to the application status bar.
 * @param {String} msg The message to log.
 */
function log(msg) {
	var elem;

	console.log(msg);
	elem = $('#log');
	if (elem) {
		elem.html(msg);
	}
}

//  =========================================================================== 
//  Dataset Helper Class
//  =========================================================================== 

/**
 * Dataset management helper class. This type encapsulates access to the raw
 * data structures in a JSON object.
 * @constructor
 */
function Dataset(data) {

	if (!data) {
		throw new Error('Invalid dataset');
	}

	/**
	 * The JSON data to encapsulate.
	 * @type {Object}
	 */
	this._data = data;

	/**
	 * Lookup table of precomputed values related to the data slices. The top
	 * level content is populated from the keys in the SLICE dictionary.
	 * @enum {Object}
	 */
	this._lookup = {};
	this.prepareLookup();

	return this;
}

//  --------------------------------------------------------------------------- 

/**
 * Dictionary of keys into the JSON data structure's array of items.
 * @enum {String}
 */
Dataset.SLICE = {
	CADENCE: 'Cadence',
	DISTANCE: 'Distance',
	ELEVATION: 'Elevation',
	HEART_RATE: 'HeartRate',
    LATITUDE: 'Latitude',
    LONGITUDE: 'Longitude',
    LAT_LNG: 'LatLng',
	OFFSET: 'MillisecondsOffset',
	POWER: 'Power',
	RIGHT_POWER: 'RightPower',
	SPEED: 'Speed',
	TEMPERATURE: 'Temperature'
};

//  --------------------------------------------------------------------------- 

/**
 * Returns the raw datapoints from the dataset.
 * @param {String} slice The slice to return.
 * @return {Array.<Object>} The array of datapoints.
 */
Dataset.prototype.getDataPoints = function(slice) {
	var data,
		arr;

	data = this._data.FlatSamples.Samples;

	if (!slice) {
		return data;
	}

	arr = this._lookup[slice].slice;
	if (!arr) {
		arr = this.prepareSlice(slice);
	}
	return arr;
};

//  --------------------------------------------------------------------------- 

/**
 * Returns the computed min and max values for a particular slice.
 * @param {String} slice The slice name to prepare. 
 * @return {Array} The array with min, max values.
 */
Dataset.prototype.getMinMax = function(slice) {
	var dict;

	dict = this._lookup[slice];
	if (!dict) {
		this.prepareSlice(slice);
		dict = this._lookup[slice];
	}

	return [dict.min, dict.max];
};

//  --------------------------------------------------------------------------- 

/**
 * Preloads the lookup table based on the available slice keys.
 */
Dataset.prototype.prepareLookup = function() {
	var my,
		slices;

	slices = Dataset.SLICE;

	// Hold a reference to support lazy "binding" in our closure below.
	my = this;

	Object.keys(slices).map(function(key) {
		my._lookup[slices[key]] = {};
	});
};

//  --------------------------------------------------------------------------- 

/**
 * Performs an optimized pass through the source data to avoid overhead from
 * multiple iterations across the data. The named slice and lat/lng are
 * optimized as a result of this call.
 * @param {String} slice The slice name to prepare. 
 * @param {d3.scale.linear} scale The X coordinate scale for index lookup.
 * @return {Array} The array of values for the desired slice.
 */
Dataset.prototype.prepareSlice = function(slice, scale) {

	var start,
		lookup,
		min,
		max,
		minLat,
		minLng,
		maxLat,
		maxLng,
		data,
		coords,
		end,
		my,
		arr,
		x,
		i,
		lat,
		lng,
		val,
		d;

	if (!slice) {
		throw new Error('Invalid slice');
	}

	LOG = PQ.DEBUG ? log('pre-processing ' + slice) : 0;
	start = (new Date()).getTime();

	lookup = this._lookup[slice];

	arr = lookup.slice;
	if (arr) {
		return arr;
	}

	// If we've never processed Lat/Lng do it now.
	if (!this._lookup[Dataset.SLICE.LAT_LNG].slice) {
		coords = [];
		minLat = 90;
		minLng = 180;
		maxLat = -90;
		maxLng = -180;
	}

	data = this.getDataPoints();
	arr = [];
	min = Number.POSITIVE_INFINITY;
	max = Number.NEGATIVE_INFINITY;

	// Default the scale so we don't process points we can't draw anyway.
	x = scale || PQ.chart.getScaleX(this);

	// Note that we loop across the pixel range, not the dataset, since we only
	// need to produce slice data for slots we display.
	for (i = x.domain()[0]; i < x.domain()[1]; i++) {

		d = data[Math.floor(x(i))];
		val = d[slice];
		arr.push(val);

		// compute the min/max for the slice.
		min = val < min ? val : min;
		max = val > max ? val : max;

		if (coords) {

			// Normalize lat/lng values.
			lat = d.Latitude;
			lng = d.Longitude;
			if (lat === null || lng === null) {
				LOG = PQ.DEBUG ? log('Invalid lat/lng at index: ' + i) : 0;
				// Ugly, but for now to avoid issues with missing slots 
				// we'll duplicate prior value. Probably the better option here
				// is just leave it null, then replace nulls with the average of
				// the values on either side.
				coords.push(coords[coords.length - 1]);
				continue;
			}
			lat = lat.toFixed(6);
			lng = lng.toFixed(6);

			// Adjust our max/min to get boundary values.
			minLat = minLat > lat ? lat : minLat;
			minLng = minLng > lng ? lng : minLng;
			maxLat = maxLat < lat ? lat : maxLat;
			maxLng = maxLng < lng ? lng : maxLng;

			// Add the coordinate to our list.
			coords.push(new google.maps.LatLng(lat, lng));

			// Put our min/max values on the array as "metadata" in the form of
			// properties consumers can access.
			coords.minLat = minLat;
			coords.minLng = minLng;
			coords.maxLat = maxLat;
			coords.maxLng = maxLng;
		}
	}

	this._lookup[Dataset.SLICE.LAT_LNG].slice = coords;
	lookup.slice = arr;
	lookup.min = min;
	lookup.max = max;

	end = (new Date()).getTime();
	LOG = PQ.DEBUG ?
		log('pre-processed ' + slice + ' in ' + (end - start) + 'ms.') : 0;

	return arr;
};

//  =========================================================================== 
//  Chart Helper Class 
//  =========================================================================== 

/**
 * Helper class for working with the HTML5 Canvas element.
 * @param {String} id The element ID for the Chart's canvas element.
 * @constructor
 */
function Chart(id) {

	if (!id) {
		throw new Error('Invalid ID');
	}

	/**
	 * The chart's d3 element wrapper.
	 * @type {d3.Element}
	 */
	this._d3elem = d3.select(id);
	if (!this._d3elem) {
		throw new Error('Invalid Chart Element');
	}

	/**
	 * The chart's native node.
	 * @type {Element}
	 */
	this._node = this._d3elem.node();

	/**
	 * The canvas element's drawing context.
	 * @type {2DContext}
	 */
	this._ctx = this._node.getContext('2d');

	/**
	 * X coordinate of where a mouse selection in the chart was started.
	 * @type {Number}
	 */
	this._mouseX = null;


	/**
     * The D3 scale used to map pixels to dataset slots for performance.
	 * @type {d3.scale.linear}
     */
	this._scaleX = null;

	this.prepareChart();

	return this;
}

//  --------------------------------------------------------------------------- 

/**
 * Returns the X coordinate of the event, translated to canvas coordinates.
 * @param {Event} event The native mouse event.
 * @return {Number} The X coordinate.
 */
Chart.prototype.getMouseX = function(event) {
	var rect;

	rect = this._node.getBoundingClientRect();
	return event.clientX - rect.left;
};

//  --------------------------------------------------------------------------- 

/**
 * Return a D3 scale for converting X coordinates into dataset indexes.
 * @param {Dataset} dataset The dataset being scaled.
 * @return {d3.scale.linear} A linear scaling function.
 */
Chart.prototype.getScaleX = function(dataset) {
	var ctx,
		w,
		data;

	ctx = this._ctx;
	w = ctx.canvas.width;
	data = dataset.getDataPoints();

	// Create a scale that will translate pixels to slots for X.
	this._scaleX = d3.scale.linear().
		domain([0, w]).
		range([0, data.length]);

	return this._scaleX;
};

//  --------------------------------------------------------------------------- 

/**
 * Prepares the chart surface for rendering, setting the scale etc.
 */
Chart.prototype.prepareChart = function() {
	var w,
		h,
		my;

	// Assign the chart height/width to ensure 1:1 scaling.
	w = $(this._node).width();
	h = $(this._node).height();
	this._ctx.canvas.width = w;
	this._ctx.canvas.height = h;

	// Hold a reference to support lazy "binding" in our closure below.
	my = this;

	// Watch for events on the chart so we can notify the controller to refresh.
	this._d3elem.on('mousedown', function() {
		my._mouseX = my.getMouseX(d3.event);
	});

	this._d3elem.on('mouseup', function() {
		var start,
			end,
			x1,
			x2;

		start = my._mouseX;
		end = my.getMouseX(d3.event);

		x1 = start < end ? start : end;
		x2 = start < end ? end : start;

		// A better approach is custom events but for now we'll invoke the
		// handler directly.
		PQ.handleSelectionChange(x1, x2);
	});

};

//  --------------------------------------------------------------------------- 

/**
 * Renders relevant data slices from the dataset provided.
 * @param {Dataset} dataset The dataset used for source data.
 */
Chart.prototype.render = function(dataset, slice) {
	var chart,
		ctx,
		data,
		h,
		w,
		x,
		y,
		i,
		val,
		y1,
		start,
		end;

	LOG = PQ.DEBUG ? log('chart rendering ' + slice) : 0;
	start = (new Date()).getTime();

	// Get the chart and context.
	chart = this._d3elem;
	ctx = this._ctx;

	// Capture height and width to give us X and Y domain figures.
	h = ctx.canvas.height;
	w = ctx.canvas.width;

	// NOTE the slice is already just the length of the canvas. The dataset will
	// use a linear scale to return only points we can plot.
	data = dataset.getDataPoints(slice);

	// Create a scale that will translate pixels to values for Y. Note that we
	// need the slice information for this so we don't precompute.
	y = d3.scale.linear().
		domain(dataset.getMinMax(slice)).
		range([10, h - 10]);		// Note we leave 10 px for offsets.

	ctx.strokeWidth = 2;
	ctx.strokeStyle = PQ.COLOR.MAP_PATH;

	ctx.beginPath();
	// Move from left to right 1 pixel at a time, pulling data from the slots
	// defined by our scale.
	for (i = 0; i < w; i++) {
		val = Math.floor(data[i]);
		y1 = h - y(val);
		if (i === 0) {
			ctx.moveTo(i, y1);
		} else {
			ctx.lineTo(i, y1);
		}
	}
	ctx.stroke();

	end = (new Date()).getTime();
	LOG = PQ.DEBUG ? log('chart rendered in ' + (end - start) + 'ms.') : 0;
};

//  =========================================================================== 
//  Map Helper Class 
//  =========================================================================== 

/**
 * Helper class for working with the Google Maps 3.0 Map API.
 * @param {String} id The element ID for the map's native element container.
 * @constructor
 */
function Mapper(id) {

	if (!id) {
		throw new Error('Invalid ID');
	}

	/**
	 * The array of LatLng coordinates being rendered on the map.
	 * @type {Array.<google.map.LatLng>}
	 */
	this._coords = null;

	/**
	 * The map's d3 element wrapper.
	 * @type {d3.Element}
	 */
	this._d3elem = d3.select(id);
	if (!this._d3elem) {
		throw new Error('Invalid Map Element');
	}

	/**
	 * The Google map instance for the mapper. This is initialized during the
	 * prepareMap call.
	 * @type {google.maps.Map}
	 */
	this._map = null;

	/**
	 * Array of Polyline objects currently displaying data on the map.
	 * @type {Array.<google.map.Polyline>}
	 */
	this._paths = [];

	/**
	 * The map's native node.
	 * @type {Element}
	 */
	this._node = this._d3elem.node();

	this.prepareMap();

	return this;
}

//  --------------------------------------------------------------------------- 

/**
 * Dictionary of common lookup values for the Mapper type.
 * @enum {Object}
 */
Mapper.DEFAULT = {
	LAT: 40.012377,					// Peaksware Lat. Default map center lat.
	LNG: -105.132251				// Peaksware Lng. Default map center lng.
};

//  --------------------------------------------------------------------------- 

/**
 * Removes any paths from the map.
 */
Mapper.prototype.clearMap = function() {
	// Remove the paths from the map.
	this._paths.map(function(path) {
		path.setMap(null);
	});

	// Truncate the path list.
	this._paths.length = 0;
};

//  --------------------------------------------------------------------------- 

/**
 * Renders a default map using the Google Maps 3.0 API.
 * @return {google.maps.Map} The map object created for rendering map content.
 */
Mapper.prototype.prepareMap = function() {
	var mapOptions;

	mapOptions = {
		center: new google.maps.LatLng(Mapper.DEFAULT.LAT, Mapper.DEFAULT.LNG),
		zoom: 12,
		mapTypeId: google.maps.MapTypeId.ROADMAP
	};

	this._map = new google.maps.Map(this._node, mapOptions);
};

//  --------------------------------------------------------------------------- 

/**
 * Renders relevant data slices from the dataset provided.
 * @param {Dataset} dataset The dataset used for source data.
 */
Mapper.prototype.highlight = function(x1, x2) {
	var start,
		coords,
		path,
		end;

	LOG = PQ.DEBUG ? log('map points refreshing') : 0;
	start = (new Date()).getTime();

	this.clearMap();

	coords = this._coords;

	path = new google.maps.Polyline({
		path: coords.slice(0, x1),
		strokeColor: PQ.COLOR.MAP_PATH,
		strokeOpacity: 1,
		strokeWeight: 2
	});
	path.setMap(this._map);
	this._paths.push(path);

	path = new google.maps.Polyline({
		path: coords.slice(x1, x2),
		strokeColor: PQ.COLOR.MAP_SEGMENT,
		strokeOpacity: 1,
		strokeWeight: 2
	});
	path.setMap(this._map);
	this._paths.push(path);

	path = new google.maps.Polyline({
		path: coords.slice(x2),
		strokeColor: PQ.COLOR.MAP_PATH,
		strokeOpacity: 1,
		strokeWeight: 2
	});
	path.setMap(this._map);
	this._paths.push(path);

	end = (new Date()).getTime();
	LOG = PQ.DEBUG ? log('map points rendered in ' + (end - start) + 'ms.') : 0;
};

//  --------------------------------------------------------------------------- 

/**
 * Renders relevant data slices from the dataset provided.
 * @param {Dataset} dataset The dataset used for source data.
 */
Mapper.prototype.render = function(dataset, slice) {
	var start,
		coords,
		path,
		swLatLng,
		neLatLng,
		bounds,
		end;

	LOG = PQ.DEBUG ? log('map points rendering') : 0;
	start = (new Date()).getTime();

	coords = dataset.getDataPoints(Dataset.SLICE.LAT_LNG);
	this._coords = coords;

	// Create the polyline for the mapped route.
	path = new google.maps.Polyline({
		path: coords,
		strokeColor: PQ.COLOR.MAP_PATH,
		strokeOpacity: 1,
		strokeWeight: 2
	});
	// Render the path on the map.
	path.setMap(this._map);
	this._paths.push(path);

	// NOTE This works only in the northern-western hemisphere.
	// For the north-western hemisphere lat goes up as we approach the pole
	// (larger numbers are more northern) and lng goes "down" as we move west
	// (smaller numbers are more westerly). 
	swLatLng = new google.maps.LatLng(coords.minLat, coords.maxLng);
	neLatLng = new google.maps.LatLng(coords.maxLat, coords.minLng);

	// Fit to the bounds and zoom in a bit to provide better view.
	bounds = new google.maps.LatLngBounds(swLatLng, neLatLng);
	this._map.fitBounds(bounds);
	this._map.setZoom(this._map.getZoom() + 1);

	end = (new Date()).getTime();
	LOG = PQ.DEBUG ? log('map points rendered in ' + (end - start) + 'ms.') : 0;
};

//  =========================================================================== 
//  Averager Helper Class
//  =========================================================================== 

/**
 * Computes averages across a large dataset by leveraging individual Web Workers
 * to compute averages for slices. The partial result sets are then merged back
 * together to produce the final result.
 * @param {Array} data The array of numbers to average.
 * @param {Number} chunk_size The size of each subset of data.
 * @constructor
 */
function Averager(data) {

	if (!data) {
		throw new Error('Invalid dataset');
	}

	/**
	 * Flag controlling when the instance is already busy computing a result.
	 * @type {Boolean}
	 */
	this._busy = false;

	/**
	 * An optional callback function to invoke when compute operations finish.
	 * @type {Function}
	 */
	this._callback = null;

	/**
	 * The number of items in each chunk to be processed by a worker.
	 * @type {Number}
	 */
	this._chunkSize = null;

	/**
	 * The array of numbers to compute an overall average for.
	 * @type {Array.<Number>}
	 */
	this._data = data;

	/**
	 * The individual results from the various worker threads.
	 * @type {Array.<Object>}
	 */
	this._results = [];

	/**
	 * The current worker instances being monitored for computation.
	 * @type {Array.<Object>}
	 */
	this._workers = [];

	return this;
}

//  --------------------------------------------------------------------------- 

/**
 * Dictionary of default values for the type.
 * @enum {Object}
 */
Averager.DEFAULT = {
	CHUNK: 300,
	URL: '/src/averager.js'
};

//  --------------------------------------------------------------------------- 

/**
 * Creates a worker for a particular slice of data and starts it running.
 * @param {Array.<Number>} slice The slice to compute an average for.
 * @return {Worker} The web worker instance.
 */
Averager.prototype.createWorker = function(slice) {
	var worker,
		my;

	// Hold a reference to support lazy "binding" in our closure below.
	my = this;

	worker = new Worker(Averager.DEFAULT.URL);
	worker.addEventListener('message', function(evt) {
		my.handleWorkerComplete(worker, evt);
	}, false);

	LOG = PQ.DEBUG ? log('worker ' + this._workers.length + ' created') : 0;

	this._workers.push(worker);
	worker.postMessage(JSON.stringify(slice));

	return worker;
};

//  --------------------------------------------------------------------------- 

/**
 * Computes the final result from the individual thread results.
 * @return {Number} The collated average.
 */
Averager.prototype.collateResults = function() {
	// TODO
	// Of course.
	return 42;
};

//  --------------------------------------------------------------------------- 

/**
 * Initiates computation of an average for the current data.
 * @param {Function} callback An optional callback to invoke with the final
 *     result of the computation.
 */
Averager.prototype.compute = function(callback) {
	var chunk,
		slice,
		data,
		result,
		i,
		len,
		sum,
		avg,
		val;

	// Without workers just compute manually :(.
	if (!window.Worker) {
		data = this._data;
		len = data.length;
		for (i = 0; i < len; i++) {
			val = data[i];
			if (val !== null) {
				sum += val;
			}
		}
		result = {
			count: len,
			sum: sum
		};
		if (callback) {
			// NOTE the array here to simulate a single worker result.
			callback([result]);
		} else {
			return [result];
		}
	}

	if (this._busy) {
		throw new Error('Averager busy');
	}
	this._busy = true;

	// Hold reference to call when we're complete.
	this._callback = callback;

	chunk = this._chunkSize || Averager.DEFAULT.CHUNK;

	// Make a copy so we don't splice the original to create chunks.
	data = this._data.slice(0);

	slice = data.splice(0, chunk);
	while (slice.length > 0) {
		this.createWorker(slice);
		slice = data.splice(0, chunk);
	}
};

//  --------------------------------------------------------------------------- 

/**
 * Returns the index of a worker instance.
 * @param {Worker} worker The worker instance to locate.
 * @return {Number} The worker index, or -1 if not found.
 */
Averager.prototype.getWorkerIndex = function(worker) {
	var i,
		len,
		workers;

	workers = this._workers;
	len = workers.len;

	for (i = 0; i < len; i++) {
		if (workers[i] === worker) {
			return i;
		}
	}

	// The quintessential NOT_FOUND for JavaScript.
	return -1;
};

//  --------------------------------------------------------------------------- 

/**
 * Handles notifications from individual workers that they are finished.
 * @param {Worker} worker The worker which has completed.
 * @param {Object} evt The worker "event" (aka message).
 */
Averager.prototype.handleWorkerComplete = function(worker, evt) {
	var index,
		result;

	index = this.getWorkerIndex(worker);
	LOG = PQ.DEBUG ? log('worker ' + index + ' complete') : 0;

	result = JSON.parse(evt.data);
	this._results.push(result);

	// If all workers have reported in we're done.
	if (this._results.length === this._workers.length) {

		// Protect ourselves from bad callback functions.
		try {
			if (this._callback) {
				this._callback(this._results);
			}
		} finally {
			this._busy = false;
			this._results.length = 0;
			this._workers.length = 0;
		}
	}
};

//  --------------------------------------------------------------------------- 

/**
 * Sets the chunk size used in computations. The default is
 * Averager.DEFAULT.CHUNK number of items.
 * @param {Number} size The chunk size to use.
 */
Averager.prototype.setChunkSize = function(size) {
	this._chunkSize = size;
};

//  =========================================================================== 
//  PeakswareQuiz (PQ) Application Controller
//  =========================================================================== 

/**
 * The primary "driver" object for the application. The PQ object handles
 * initial processing and dynaloading of necessary resources. Once the low-level
 * resources are available helper classes are leveraged to encapsulate the rest
 * of the application processing. The PQ object continues to serve as a common
 * controller for coordinating between the model and views as needed.
 * @type {Object}
 */
PQ = {};

//  --------------------------------------------------------------------------- 
//  Flags, Constants, and Enums
//  --------------------------------------------------------------------------- 

/**
 * Flag for turning on debugging output to the Javascript console. This flag is
 * set onload by checking the application URL for #debug or &debug=true.
 * Note that normally we wouldn't use all caps for a non-constant value, but we
 * want PQ.DEBUG to stand out in code.
 * @type {Boolean}
 */
PQ.DEBUG = false;


/**
 * Flag for whether the dataset has finished loading or not.
 * @type {Boolean}
 */
PQ.datasetLoaded = false;


/**
 * Load time end for dataset.
 * @type {Number} The millisecond time when data finished loading.
 */
PQ.datasetLoadEnd = 0;


/**
 * Load time start for dataset.
 * @type {Number} The millisecond time when data started loading.
 */
PQ.datasetLoadStart = 0;


/**
 * Flag for whether the Google Map API has finished loading or not.
 * @type {Boolean}
 */
PQ.mappingLoaded = false;


/**
 * Load time end for the map API.
 * @type {Number} The millisecond time when the API finished loading.
 */
PQ.mappingLoadEnd = 0;


/**
 * Load time start for the map API.
 * @type {Number} The millisecond time when the API started loading.
 */
PQ.mappingLoadStart = 0;

//  --------------------------------------------------------------------------- 

/**
 * Dictionary of common colors for easier color adjustment/theming. The current
 * values are derived from the TrainingPeaks web site's primary color scheme.
 * @enum {string}
 */
PQ.COLOR = {
    LIGHT: '#fff',			// White, or "whiteish".
    DARK:   '#000',			// Black, or "blackish".

	LIGHT_BG: '#efefef',	// Light grey background.
	MED_BG: '#1E558B',		// Medium blue background.
	DARK_BG: '#222',		// Dark grey background.

	LIGHT_TXT: '#aaa',		// Light grey text color.
	MED_TXT: '#005695',		// "Peaks" text color.
	DARK_TXT: '#00264C',	// "Training" text color.
	BLACK_TXT: '#ccc',		// "Off black" text color.

	MAP_PATH: '#005695',
	MAP_SEGMENT: 'red'
};

//  --------------------------------------------------------------------------- 

/**
 * Dictionary of common default values to avoid "magic values" in the code.
 * @enum {object}
 */
PQ.DEFAULT = {
	DATA_URL: '/dat/peaksware.json',	// Default url for sample json dataset.

	MAP_KEY: 'AIzaSyAn3K6N9JR-CnRcQkAGvkxFiYXgz6yxaRI',	// API demo key
	MAP_URL: 'http://maps.googleapis.com/maps/api/js?key={key}&sensor=false',

	SLICE: 'Power'		// Bit of a hack. Have to keep sync'd with Dataset.
};

//  --------------------------------------------------------------------------- 
//	Helper Instance Variables
//  --------------------------------------------------------------------------- 

/**
 * The Chart helper instance used to encapsulate chart rendering.
 * @type {Chart}
 */
PQ.chart = null;


/**
 * The dataset instance used as the charting/mapping data source.
 * @type {Dataset}
 */
PQ.dataset = null;


/**
 * The mapper instance used to encapsulate map rendering.
 * @type {Mapper}
 */
PQ.map = null;

//  --------------------------------------------------------------------------- 
//	Static Methods
//  --------------------------------------------------------------------------- 

/**
 * Compute an average for slices of the dataset using a threaded Averager.
 * @param {Array} data The slice of data to process.
 */
PQ.average = function(data, callback) {
	var averager;

	averager = new Averager(data);
	averager.compute(callback);
};

//  --------------------------------------------------------------------------- 

/**
 * Initialize the application on startup. This function should be invoked via
 * the home page's onload handler to initialize the application driver logic.
 */
PQ.init = function() {

	// Check on debugging output flag status.
	PQ.DEBUG = window.location.href.toString().match(/#debug|&debug=true/);
	LOG = PQ.DEBUG ? log('Debugging output enabled.') : 0;

	// Set up initial event handler to trigger activation.
	d3.select('#splash').on('click', PQ.handleSplashClick);
};

//  --------------------------------------------------------------------------- 

/**
 * Load the dataset for the application.
 * @param {String} source_url The url to load from. Defaults to
 *     PQ.DEFAULT.DATA_URL.
 */
PQ.loadDataset = function(source_url) {
	var url;

	url = source_url || PQ.DEFAULT.DATA_URL;

	LOG = PQ.DEBUG ? log('dataset loading from ' + url) : 0;

	PQ.datasetLoadStart = (new Date()).getTime();
	d3.json(url, PQ.handleDatasetLoaded);
};

//  --------------------------------------------------------------------------- 

/**
 * Dynamically load the Google Map API script. Once the API has loaded the
 * PQ.mappingLoaded flag will be set to true.
 */
PQ.loadMapping = function() {
	var script;

	script = document.createElement('script');

	// NOTE we use callback= here to define the load handler to invoke.
	script.src = PQ.DEFAULT.MAP_URL.replace(/\{key\}/, PQ.DEFAULT.MAP_KEY) +
		'&callback=PQ.handleMappingLoaded';

	LOG = PQ.DEBUG ? log('map api loading from ' + script.src) : 0;

	PQ.mappingLoadStart = (new Date()).getTime();
	document.body.appendChild(script);
};

//  --------------------------------------------------------------------------- 

/**
 * Handles notification of d3.json() loading of the target dataset. If there was
 * an error in the d3.json call the value for 'data' will be null. If the map
 * api has also been loaded this method will trigger the PQ.render() call.
 * @param {Object} data The JSON data in object form, or null on error.
 */
PQ.handleDatasetLoaded = function(data) {

	PQ.datasetLoadEnd = (new Date()).getTime();

	if (!data) {
		// This will be caught by our top-level onerror hook and logged.
		throw new Error('Error accessing training data.');
	}

	PQ.datasetLoaded = true;
	LOG = PQ.DEBUG ? log('dataset loaded in ' +
		(PQ.datasetLoadEnd - PQ.datasetLoadStart) + 'ms.') : 0;

	// Instantiate a Dataset helper we'll use to encapsulate data access.
	PQ.dataset = new Dataset(data);

	// If we know the both api and data are ready we can render.	
	if (PQ.mappingLoaded) {
		PQ.render();
	}
};

//  --------------------------------------------------------------------------- 

/**
 * Handles notification of Google Map API loading. This method is invoked when
 * dynamically loading the Map API by using its name as the 'callback=' value.
 * If both dataset and map have loaded this method will trigger PQ.render().
 */
PQ.handleMappingLoaded = function() {

	PQ.mappingLoadEnd = (new Date()).getTime();

	PQ.mappingLoaded = true;
	LOG = PQ.DEBUG ? log('map api loaded in ' +
		(PQ.mappingLoadEnd - PQ.mappingLoadStart) + 'ms.') : 0;

	// Render the base map. We'll render overlays once data is ready. Doing the
	// map render as soon as the API comes online helps with the perception of
	// things moving faster tho.
	PQ.map = new Mapper('#map');

	// If we know the both api and data are ready we can render.	
	if (PQ.datasetLoaded) {
		PQ.render();
	}
};

//  --------------------------------------------------------------------------- 

/**
 * Respond to clicks on the initial splash screen, which is our trigger to run
 * the actual demo.
 * @param {Object} d The data value from the d3 event handler logic.
 * @param {Number} i The index value from the d3 event handler logic.
 */
PQ.handleSplashClick = function(d, i) {

	// Async load the dataset.
	PQ.loadDataset();

	// Async load the map API code.
	PQ.loadMapping();

	// Create a chart rendering helper to encapsulate the rendering work.
	PQ.chart = new Chart('#chart');

	// TODO
	// Strictly speaking we should put a timer here to time out if either the
	// map API load or json call take too long. If that timer flips then we want
	// to abort, update the display with the error, and offer a way to retry.

	// Fade out the splash element and then turn off display so it no longer
	// gets events.
	d3.select('#splash').transition().
		style('opacity', 0).
		style('display', 'none');

	// Fade in the primary dashboard, control surfaces, and the chart/map.
	d3.select('#dashboard').transition().
		style('opacity', 1).
		style('display', 'block');
};

//  --------------------------------------------------------------------------- 

/**
 * Highlights a section of the map specific to the coordinate range given.
 * @param {Number} x1 The X index of the start of the highlight.
 * @param {Number} x2 The X index of the end of the highlight.
 */
PQ.handleSelectionChange = function(x1, x2) {
	this.map.highlight(x1, x2);
};

//  --------------------------------------------------------------------------- 

/**
 * Renders the chart and map content. The chart can graph any slice desired. The
 * map always uses lat/lng values matching the relevant slice.
 * @param {String} slice The dataset slice to graph in the chart. 
 */
PQ.render = function(slice) {
	var dataset,
		key,
		list,
		arr,
		out,
		my;

	dataset = this.dataset;
	key = slice || PQ.DEFAULT.SLICE;

	// Preprocess data in the slices we'll be rendering. This will keep the
	// individual chart and map processes from triggering multiple passes on the
	// dataset. Note that we pass the scale from the chart which allows us to
	// skip slots we won't be accessing.
	dataset.prepareSlice(key, this.chart.getScaleX(dataset));

	this.chart.render(dataset, key);
	this.map.render(dataset);

	// NOTE that for averaging purposes we'll process the first twenty minutes
	// (1200 seconds) of data.
	arr = [];
	list = dataset.getDataPoints().slice(0, 1200);
	list.map(function(d) {
		arr.push(d[key]);
	});

	out = [];

	// Hold a reference to support lazy "binding" in our closure below.
	my = this;

	// Compute one minute average.
	this.average(arr.slice(0, 60), function(results) {

		// Save first minute result.
		out.push((results[0].sum / results[0].count).toFixed(2));

		// Compute five minute averages and output them.
		my.average(arr, function(results) {
			var len,
				i,
				j,
				sum,
				count;

			sum = 0;
			count = 0;
			len = results.length;
			for (i = 0; i < len; i++) {
				for (j = 0; j <= i; j++) {
					sum += results[i].sum;
					count += results[i].count;
				}
				out.push((sum / count).toFixed(2));
			}

			log('Average ' + key + ' at 1, 5, 10, 15, and 20 minutes: ' +
				out.join(', ') + ' respectively.');
		});
	});
};

//  =========================================================================== 
//  EXPORT ETC.
//  =========================================================================== 

//  Export PQ using variant cribbed from underscore.js. The goal is to ensure
//  export works across all containers.
if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PQ;
    }
    exports.PQ = PQ;
} else {
    root.PQ = PQ;
}

//  --------------------------------------------------------------------------- 

// Force 'this' at the outer context to be 'this' within our closure. This helps
// ensure that the module can export properly on client or server.
}(this));

//  ===========================================================================
//  end
//  ===========================================================================
