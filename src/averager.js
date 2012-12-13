//  ===========================================================================
/**
* @fileoverview JavaScript for computing an average in a worker thread.
* @author Scott Shattuck (ss)
* @copyright 2012 Scott Shattuck, All Rights Reserved.
*/
//  =========================================================================== 

/*jslint anon:true, nomen:true, plusplus:true, continue:true */
/*globals google, d3, $ */

'use strict';

//  --------------------------------------------------------------------------- 

/**
 * Handles inbound messages from the main thread sent via postMessage.
 * @param {MessageEvent} evt The inbound message.
 */
function messageHandler(evt) {
	compute(JSON.parse(evt.data));
};

/**
 * Computes the average for the data provided.
 * @param {Array} data The data to average.
 */
function compute(data) {
	var i,
		val,
		sum,
		len,
		result;

	len = data.length;
	sum = 0;

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

	done(JSON.stringify(result));
}

/**
 * Writes a message back to the main thread via postMessage.
 * @param {String} msg A JSON string containing the desired message content.
 */
function done(msg) {
	postMessage(msg);
}

// Register the event handler or we'll sit quietly waiting forever :).
this.addEventListener('message', messageHandler, false);

//  ===========================================================================
//  end
//  ===========================================================================
