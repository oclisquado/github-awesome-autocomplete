//
// Extension messaging system.
//
//
// This module, when used, allows communication among any extension-related
// contexts (background script, content scripts, development tools scripts, any
// JS code running in extension-related HTML pages, such as popups, options,
// ...).
//
// To start using the system, one needs to invoke exported `init` function from
// background script (once), passing 'bg' as the name of the context, optionally
// providing message handling functions. This will install onConnect listener
// for incoming Port connections from all other context.
//
// Any other context (with arbitrary name and (optional) message handlers) also
// invokes the `init` function. In this case, Port is created and connected to
// background script.
//
// Note: due to bug https://code.google.com/p/chromium/issues/detail?id=356133
// we also have dedicated name for developer tools context: 'dt'. Once this bug
// is fixed, the only reserved context name will be 'bg' for background again.
//
// To avoid race conditions, make sure that your background script calls `init`
// function after it is started, so it doesn't miss any Port connections
// attempts.
//
// To be able to handle commands (or associated messages) in contexts (both
// background and non-background), one must pass message handling functions in
// `handlers` object when invoking respective `init` function for given context.
// The `handlers` object is a function lookup table, i.e. object with function
// names as its keys and functions (code) as corresponding values. The function
// will be invoked, when given context is requested to handle message
// representing command with name that can be found as a key of the `handlers`
// object. Its return value (passed in callback, see below) will be treated as
// value that should be passed back to the requestor.
//
// Each message handling function can take any number of parameters, but MUST
// take callback as its last argument and invoke this callback when the message
// handler is done with processing of the message (regardless if synchronous or
// asynchronous). The callback takes one argument, this argument is treated as
// return value of the message handler. The callback function MUST be invoked
// once and only once.
//
// The `init` function returns (for any context it is invoked in) messaging
// object with two function: `cmd` and `bcast`, both used for sending messages
// to different contexts (or same context in different windows / tabs).
//
// Both functions behave the same way and have also the same arguments, the only
// difference is that the `cmd` callback (its last argument, if provided) is
// invoked with only one response value from all collected responses, while to
// the `bcast` callback (if provided) we pass array with all valid responses we
// collected while broadcasting given request.
//
// `cmd` and `bcast` functions arguments:
//
// (optional) [int] tabId: if not specified, broadcasted to all tabs,
//      if specified, sent only to given tab, can use SAME_TAB value here
//      (exported from this module, too)
//
// (optional) [array] contexts: if not specified, broadcasted to all contexts,
//      if specified, sent only to listed contexts (context name is provided
//      as the first argument when invoking the `init` function)
//
// (required) [string] command: name of the command to be executed
//
// (optional) [any type] arguments: any number of aruments that follow command
//      name are passed to execution handler when it is invoked
//
// (optional) [function(result)] callback: if provided (as last argument to
//      `cmd` or `bcast`), this function will be invoked when the response(s)
//      is/are received
//
// The `cmd` and `bcast` functions return `true` if the processing of the
// request was successful (i.e. if all the arguments were recognized properly),
// otherwise it returns `false`.
//
// When `cmd` or `bcast` function is invoked from background context, a set of
// context instances, to which the message will be sent to, is created based on
// provided arguments (tab id and context names). The set is NOT filtered by
// provided command name, as background context doesn't know what message
// handlers are used in all the contexts (i.e. it doesn't know the function
// names in message handling lookup function tables of non-background contexts).
//
// When tab id or context names are NOT provided, the command is broadcasted to
// all possible context instances, which the background knows about, and that
// may require a lot of messaging... So for performance reasons it is wise to
// provide tab-id and / or context name(s) whenever possible to reduce the size
// of the context instances set as much as it gets.
//
// When message corresponding to command is then received in non-background
// context, the handler lookup table is checked if it contains handler for
// requested command name. If so, the handler is invokend and its "return value"
// (passed in callback, to allow asynchronous message handling) is then sent
// back to background. If there is no corresponding handler (for requested
// command name), message indicating that is sent back instead.
//
// When background collects all the responses back from all the context
// instances it sent the message to, it invokes the `cmd` or `bcast` callback,
// passing the response value(s). If there was no callback provided, the
// collected response values are simply dropped.
//
// When `cmd` or `bcast` function is invoked from non-background context, the
// request message is sent to background. Background then dispatches the request
// to all relevant context instances that match provided filters (again, based on
// passed tab id and / or context names), and dispatches the request in favor of
// the context instance that sent the original request to background. The
// dispatching logic is described above (i.e. it is the same as if the request
// was sent by background).
//
// There is one difference though: if background has corresponding handler for
// requested command name (and background context is not filtered out when
// creating the set of contexts), this handler is invoked (in background
// context) and the "return value" is also part of the collected set of
// responses.
//
// When all the processing in all the context instances (including background
// context, if applicable) is finished and responses are collected, the
// responses are sent back to the original context instance that initiated the
// message processing.
//
//
// EXAMPLE:
//
// background script:
// -----
//
// var msg = require('msg').init('bg', {
//   square: function(what, done) { done(what*what); }
// });
//
// setInterval(function() {
//   msg.bcast(/* ['ct'] */, 'ping', function(responses) {
//     console.log(responses);  // --->  ['pong','pong',...]
//   });
// }, 1000);  // broadcast 'ping' each second
//
//
// content script:
// -----
//
// var msg = require('msg').init('ct', {
//   ping: function(done) { done('pong'); }
// });
//
// msg.cmd(/* ['bg'] */, 'square', 5, function(res) {
//   console.log(res);  // ---> 25
// });
//
// ----------
//
// For convenient sending requests from non-background contexts to
// background-only (as this is most common case: non-bg context needs some info
// from background), there is one more function in the messaging object returned
// by the init() function. The function is called 'bg' and it prepends the list
// of passed arguments with ['bg'] array, so that means the reuqest is targeted
// to background-only. The 'bg' function does NOT take 'tabId' or 'contexts'
// parameters, the first argument must be the command name.
//
// EXAMPLE:
//
// background script
// -----
//
// ( ... as above ... )
//
// content script:
// -----
//
// var msg = require('msg').init('ct', {
//   ping: function(done) { done('pong'); }
// });
//
// msg.bg('square', 5, function(res) {
//   console.log(res);  // ---> 25
// });
//
// ----------
//
// There are two dedicated background handlers that, when provided in `handlers`
// object for `bg` context in `init` function, are invoked by the messaging
// system itself. These handlers are:
//
// + onConnect: function(contextName, tabId),
// + onDisconnect: function(contextName, tabId)
//
// These two special handlers, if provided, are invoked when new Port is
// connected (i.e. when `init` function is invoked in non-bg context), and
// then when they are closed (disconnected) later on. This notification system
// allows to maintain some state about connected contexts in extension
// backround.
//
// Please note that unlike all other handlers passed as the `handlers` object to
// `init` function, these two special handlers do NOT take callback as their
// last arguments. Any return value these handlers may return is ignored.
//
// The `contextName` parameter is value provided to non-background `init`
// function, while the `tabId` is provided by the browser. If tabId is not
// provided by the browser, the `tabId` will be `Infinity`.
//


// constant for "same tab as me"
var SAME_TAB = -1000;  // was -Infinity, but JSON.stringify() + JSON.parse() don't like that value

// handlers available in given context (function lookup table), set in `init()`
// format:
// {
//   (string)<functioName>: (function)<code>,
//   ...
// }
var myHandlers;

// id assigned by background, used in non-background contexts only
// in background set to 'bg'
var myId;

// port used for communication with background (i.e. not used in background)
// type: (chrome.runtime) Port
var myPort;

// callback lookup table: if request waits for response, this table holds
// the callback function that will be invoke upon response
// format:
// {
//   (int)<requestId>: (function)<callback code>,
//   ...
// }
var myCbTable = {};

// background table of pending requests
// format:
// {
//   (string)<portId>: [ { id: (int)<requestId>, cb: (function)<callback> }, ...],
//   ...
// }
var bgPendingReqs = {};

// unique context id, used by background
var uId = 1;

// request id, used by all contexts
var requestId = 1;

// run-time API:
// variable + exported function to change it, so it can be mocked in unit tests
/* global chrome */
var runtime = ('object' === typeof(chrome)) && chrome.runtime;
// the same for devtools API:
var devtools = ('object' === typeof(chrome)) && chrome.devtools;

// utility function for looping through object's own keys
// callback: function(key, value, obj) ... doesn't need to use all 3 parameters
// returns object with same keys as the callback was invoked on, values are the
//   callback returned values ... can be of course ignored by the caller, too
function forOwnProps(obj, callback) {
  if ('function' !== typeof(callback)) {
    return;
  }
  var res = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      res[key] = callback(key, obj[key], obj);
    }
  }
  return res;
}

// mapping non-background context names to objects indexed by name of the context
// instances, holding { tab-id, (chrome.runtime.)Port } pairs,
// used for message dispatching
// format:
// {
//   (string)<category>: {
//     (string)<id>: { tabId: (optional)<int>, port: <chrome.runtime.Port> },
//     ...
//   },
//   ...
// }
// background-only variable
var portMap = {};

// background function for selecting target ports to which we broadcast the request
// fromBg: is the request to collect targets from bacground, or based on message?
// returns array of { port: (chrome.runtime.Port), id: (string) }
function selectTargets(fromBg, targTabId, targCategories, myCategory, myPortId) {
  var res = [];
  var _port = portMap[myCategory] && portMap[myCategory][myPortId];
  if (!fromBg && !_port) {
    // this should never happen, we just got request from this port!
    return [];
  }
  if (!fromBg && (targTabId === SAME_TAB)) {
    targTabId = _port.tabId;
  }
  // iterate through portMap, pick targets:
  forOwnProps(portMap, function(categ, portGroup) {
    if (targCategories && (-1 === targCategories.indexOf(categ))) {
      // we are interested only in specified contexts,
      // and this category is not on the list
      return;
    }
    forOwnProps(portGroup, function(id, _ref) {
      if (targTabId && (targTabId !== _ref.tabId)) {
        // we are interested in specified tab id,
        // and this id doesn't match
        return;
      }
      if (fromBg || (_port.port !== _ref.port)) {
        // do not ask me back, ask only different ports
        res.push({ port: _ref.port, id: id });
      }
    });
  });
  return res;
}

// message handler (useb by both background and non-backound)
function onCustomMsg(message) {

  var _port, _arr, _localHandler, _ref, i;

  // helper functions:

  // send response on result (non-background):
  function sendResultCb(result) {
    if (message.sendResponse) {
      myPort.postMessage({
        cmd: 'response',
        portId: myId,
        reqId: message.reqId,
        resultValid: true,
        result: result
      });
    }
  }

  // create callback waiting for N results, then send response (background):
  function createCbForMoreResults(N) {
    var results = [];
    return function(result, resultValid) {
      if (resultValid !== false) {  // can be either `true` or `undefined`
        results.push(result);
      }
      N--;
      if (!N && message.sendResponse && portMap[message.category] &&
          (_port = portMap[message.category][message.portId])) {
        _port.port.postMessage({
          cmd: 'response',
          reqId: message.reqId,
          result: message.broadcast ? results : results[0]
        });
      }
    };
  }

  // main message processing:
  if (!message || !message.cmd) {
    return;
  }
  if ('setName' === message.cmd) {
    myId = message.name;
    return;
  }
  if ('bg' === myId) {
    // background
    if ('request' === message.cmd) {
      var targetPorts = selectTargets(false, message.tabId, message.contexts,
                                      message.category, message.portId);
      var responsesNeeded = targetPorts.length;
      if ( (undefined === message.tabId) &&
           (!message.contexts || (-1 !== message.contexts.indexOf('bg'))) ) {
        // we are also interested in response from background itself
        if ((_ref = myHandlers[message.cmdName]) && ('function' === typeof(_ref))) {
          _localHandler = _ref;
          responsesNeeded++;
        }
      }
      if (!responsesNeeded) {
        // no one to answer that now
        if (message.sendResponse && portMap[message.category] &&
            (_port = portMap[message.category][message.portId])) {
          _port.port.postMessage({
            cmd: 'response',
            reqId: message.reqId,
            resultValid: false,
            result: message.broadcast ? [] : undefined
          });
        }
      } else {
        // some responses needed
        var cb = createCbForMoreResults(responsesNeeded);
        // send to target ports
        for (i = 0; i < targetPorts.length; i++) {
          _port = targetPorts[i];
          _port.port.postMessage({
            cmd: 'request',
            cmdName: message.cmdName,
            sendResponse: true,
            args: message.args,
            reqId: requestId
          });
          _arr = bgPendingReqs[_port.id] || [];
          _arr.push({ id: requestId, cb: cb });
          bgPendingReqs[_port.id] = _arr;
          requestId++;
        }
        // get local response (if background can provide it)
        if (_localHandler) {
          message.args.push(cb);
          _localHandler.apply(myHandlers, message.args);
        }
      }
    } else if ('response' === message.cmd) {
      _arr = bgPendingReqs[message.portId];
      if (_arr) {
        // some results from given port expected, find the callback for reqId
        i = 0;
        while ((i < _arr.length) && (_arr[i].id !== message.reqId)) { i++; }
        if (i < _arr.length) {
          // callback found
          _arr[i].cb(message.result, message.resultValid);
          _arr.splice(i, 1);
          if (!_arr.length) {
            delete bgPendingReqs[message.portId];
          }
        }
      }
    } else if ('updateTabId' === message.cmd) {
      var _context = message.context, _portId = message.portId;
      if ((_port = portMap[_context]) && (_port = _port[_portId])) {
        if ('function' === typeof(myHandlers.onDisconnect)) { myHandlers.onDisconnect(_context, _port.tabId); }
        _port.tabId = message.tabId;
        if ('function' === typeof(myHandlers.onConnect)) { myHandlers.onConnect(_context, _port.tabId); }
      }
    }
  } else {
    // non-background
    if ('request' === message.cmd) {
      _localHandler = myHandlers[message.cmdName];
      if ('function' !== typeof(_localHandler)) {
        if (message.sendResponse) {
          myPort.postMessage({
            cmd: 'response',
            portId: myId,
            reqId: message.reqId,
            resultValid: false
          });
        }
      } else {
        message.args.push(sendResultCb);
        _localHandler.apply(myHandlers, message.args);
      }
    } else if ('response' === message.cmd) {
      if (myCbTable[message.reqId]) {
        myCbTable[message.reqId](message.result);
        delete myCbTable[message.reqId];
      }
    }
  }
}

// invoke callbacks for pending requests and remove the requests from the structure
function closePendingReqs(portId) {
  var _arr;
  if (_arr = bgPendingReqs[portId]) {
    for (var i = 0; i < _arr.length; i++) {
      _arr[i].cb(undefined, false);
    }
    delete bgPendingReqs[portId];
  }
}

// backround onConnect handler
function onConnect(port) {
  // add to port map
  var categName = port.name || 'unknown';
  var portId = categName + '-' + uId;
  uId++;
  var portCateg = portMap[categName] || {};
  var tabId = (port.sender && port.sender.tab && port.sender.tab.id) || Infinity;
  portCateg[portId] = {
    port: port,
    tabId: tabId
  };
  portMap[categName] = portCateg;
  // on disconnect: remove listeners and delete from port map
  function onDisconnect() {
    // listeners:
    port.onDisconnect.removeListener(onDisconnect);
    port.onMessage.removeListener(onCustomMsg);
    // port map:
    portCateg = portMap[categName];
    var _port;
    if (portCateg && (_port = portCateg[portId])) {
      tabId = _port.tabId;
      delete portCateg[portId];
    }
    // close all pending requests:
    closePendingReqs(portId);
    // invoke custom onDisconnect handler
    if ('function' === typeof(myHandlers.onDisconnect)) { myHandlers.onDisconnect(categName, tabId); }
  }
  // install port handlers
  port.onMessage.addListener(onCustomMsg);
  port.onDisconnect.addListener(onDisconnect);
  // ask counter part to set its id
  port.postMessage({ cmd: 'setName', name: portId });
  // invoke custom onConnect handler
  if ('function' === typeof(myHandlers.onConnect)) { myHandlers.onConnect(categName, tabId); }
}

// create main messaging object, hiding all the complexity from the user
// it takes name of local context `myContextName`
//
// the returned object has two main functions: cmd and bcast
//
// they behave the same way and have also the same arguments, the only
// difference is that to `cmd` callback (if provided) is invoked with only one
// response value from all possible responses, while to `bcast` callback (if
// provided) we pass array with all valid responses we collected while
// broadcasting given request.
//
// functions arguments:
//
// (optional) [int] tabId: if not specified, broadcasted to all tabs,
//      if specified, sent only to given tab, can use SAME_TAB value here
//
// (optional) [array] contexts: if not specified, broadcasted to all contexts,
//      if specified, sent only to listed contexts
//
// (required) [string] command: name of the command to be executed
//
// (optional) [any type] arguments: any number of aruments that follow command
//      name are passed to execution handler when it is invoked
//
// (optional) [function(result)] callback: if provided (as last argument to
//      `cmd` or `bcast`) this function will be invoked when the response(s)
//      is/are received
//
// the functions return `true` if the processing of the request was successful
// (i.e. if all the arguments were recognized properly), otherwise it returns
// `false`.
//
// for non-bg contexts there is one more function in the messaging object
// available: 'bg' function, that is the same as 'cmd', but prepends the list of
// arguments with ['bg'], so that the user doesn't have to write it when
// requesting some info in non-bg context from background.
//
function createMsgObject(myContextName) {
  // generator for functions `cmd` and `bcast`
  function createFn(broadcast) {
    // helper function for invoking provided callback in background
    function createCbForMoreResults(N, callback) {
      var results = [];
      return function(result, resultValid) {
        if (resultValid) {
          results.push(result);
        }
        N--;
        if ((N <= 0) && callback) {
          callback(broadcast ? results : results[0]);
        }
      };
    }
    // generated function:
    return function _msg() {
      // process arguments:
      if (!arguments.length) {
        // at least command name must be provided
        return false;
      }
      if (!myId) {
        // since we learn myId of non-background context in asynchronous
        // message, we may need to wait for it...
        var _ctx = this, _args = arguments;
        setTimeout(function() { _msg.apply(_ctx, _args); }, 1);
        return true;
      }
      var tabId, contexts, cmdName, args = [], callback;
      var curArg = 0, argsLimit = arguments.length;
      // check if we have callback:
      if (typeof(arguments[argsLimit-1]) === 'function') {
        argsLimit--;
        callback = arguments[argsLimit];
      }
      // other arguments:
      while (curArg < argsLimit) {
        var arg = arguments[curArg++];
        if (cmdName !== undefined) {
          args.push(arg);
          continue;
        }
        // we don't have command name yet...
        switch (typeof(arg)) {
          // tab id
          case 'number':
            if (tabId !== undefined) {
              return false; // we already have tab id --> invalid args
            }
            tabId = arg;
            break;
          // contexts  (array)
          case 'object':
            if ((typeof(arg.length) === 'undefined') || (contexts !== undefined)) {
              return false; // we either have it, or it is not array-like object
            }
            contexts = arg;
            break;
          // command name
          case 'string':
            cmdName = arg;
            break;
          // anything else --> error
          default:
            return false;
        }
      }
      if (cmdName === undefined) {
        return false; // command name is mandatory
      }
      // store the callback and issue the request (message)
      if (myId === 'bg') {
        var targetPorts = selectTargets(true, tabId, contexts);
        var responsesNeeded = targetPorts.length;
        var cb = createCbForMoreResults(responsesNeeded, callback);
        // send to target ports
        for (var i = 0; i < targetPorts.length; i++) {
          var _port = targetPorts[i];
          _port.port.postMessage({
            cmd: 'request',
            cmdName: cmdName,
            sendResponse: true,
            args: args,
            reqId: requestId
          });
          var _arr = bgPendingReqs[_port.id] || [];
          _arr.push({ id: requestId, cb: cb });
          bgPendingReqs[_port.id] = _arr;
          requestId++;
        }
        if (!targetPorts.length) {
          // no one to respond, invoke the callback (if provided) right away
          cb(null, false);
        }
      } else {
        if (callback) {
          myCbTable[requestId] = callback;
        }
        myPort.postMessage({
          cmd: 'request',
          cmdName: cmdName,
          reqId: requestId,
          sendResponse: (callback !== undefined),
          broadcast: broadcast,
          category: myContextName,
          portId: myId,
          tabId: tabId,
          contexts: contexts,
          args: args
        });
        requestId++;
      }
      // everything went OK
      return true;
    };
  }

  // returned object:
  var res = {
    cmd: createFn(false),
    bcast: createFn(true)
  };

  // for more convenience (when sending request from non-bg to background only)
  // adding 'bg(<cmdName>, ...)' function, that is equivalent to "cmd(['bg'], <cmdName>, ...)"
  if (myContextName !== 'bg') {
    res.bg = function() {
      if (0 === arguments.length || 'string' !== typeof(arguments[0])) {
        return false;
      }
      var args = [['bg']];
      for (var i = 0; i < arguments.length; i++) { args.push(arguments[i]); }
      return res.cmd.apply(res, args);
    };
  }

  return res;
}

// init function, exported
//
// takes mandatory `context`, it is any string (e.g. 'ct', 'popup', ...),
// only one value is of special meaning: 'bg' ... must be used for initializing
// of the background part, any other context is considered non-background
//
// optionally takes `handlers`, which is object mapping function names to
// function codes, that is used as function lookup table. each message handling
// function MUST take callback as its last argument and invoke this callback
// when the message handler is done with processing of the message (regardless
// if synchronous or asynchronous). the callback takes one argument, this
// argument is treated as return value of the message handler.
//
// for background (`context` is 'bg'): installs onConnect listener
// for non-background context it connects to background
//
function init(context, handlers) {
  // set message handlers (optional)
  myHandlers = handlers || {};

  // helper function:
  function onDisconnect() {
    myPort.onDisconnect.removeListener(onDisconnect);
    myPort.onMessage.removeListener(onCustomMsg);
  }

  var _tabId;
  function _updateTabId() {
    if (!myId) {
      setTimeout(_updateTabId, 1);
      return;
    }
    myPort.postMessage({
      cmd: 'updateTabId',
      context: context,
      portId: myId,
      tabId: _tabId
    });
  }

  if ('bg' === context) {
    // background
    myId = 'bg';
    runtime.onConnect.addListener(onConnect);
  } else {
    // anything else than background
    myPort = runtime.connect({ name: context });
    myPort.onMessage.addListener(onCustomMsg);
    myPort.onDisconnect.addListener(onDisconnect);
    // tabId update for developer tools
    // unfortunately we need dedicated name for developer tools context, due to
    // this bug: https://code.google.com/p/chromium/issues/detail?id=356133
    // ... we are not able to tell if we are in DT context otherwise :(
    if ( ('dt' === context) && devtools && (_tabId = devtools.inspectedWindow) &&
         ('number' === typeof(_tabId = _tabId.tabId)) ) {
      _updateTabId();
    }
  }

  return createMsgObject(context);
}

module.exports = {
  // same tab id
  SAME_TAB: SAME_TAB,

  // see description for init function above
  init: init,

  // for unit-tests only:
  __setRuntime: function(rt) { runtime = rt; }, // injecting mocked chrome.runtime API
  __setDevTools: function(dt) { devtools = dt; }, // injecting mocked chrome.devtools API
  __getPortMap: function() { return portMap; },
  __getId: function() { return myId; },
  __getPort: function() { return myPort; },
  __getHandlers: function() { return myHandlers; },
  __getPendingReqs: function() { return bgPendingReqs; }
};