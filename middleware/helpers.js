/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use strict';

var _ = require('lodash');
var fs = require('fs');
var parseurl = require('parseurl');
var path = require('path');

var helpers = require('../lib/helpers');

var getHandlerName = module.exports.getHandlerName = function getHandlerName (version, req) {
  var handlerName;

  switch (version) {
  case '1.2':
    handlerName = req.swagger.operation.nickname;
    break;

  case '2.0':
    handlerName = (req.swagger.operation['x-swagger-router-controller'] ?
      req.swagger.operation['x-swagger-router-controller'] :
      req.swagger.path['x-swagger-router-controller']) + '_' +
      (req.swagger.operation.operationId ? req.swagger.operation.operationId : req.method.toLowerCase());

    break;
  }

  return handlerName;
};

var getMockValue = function getMockValue (version, schema) {
  var value;

  switch (schema.type) {
  case 'array':
    value = [getMockValue(version, _.isArray(schema.items) ? schema.items[0] : schema.items)];

    break;

  case 'boolean':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 'true';
    }

    // Convert value if necessary
    value = value === 'true' || value === true ? true : false;

    break;

  case 'file':
  case 'File':
    value = 'Pretend this is some file content';

    break;

  case 'integer':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 1;
    }

    // Convert value if necessary
    if (!_.isNumber(value)) {
      value = parseInt(value, 10);
    }

    // TODO: Handle constraints and formats

    break;

  case 'object':
    value = {};

    _.each(schema.properties, function (property, propName) {
      value[propName] = getMockValue(version, property);
    });

    break;

  case 'number':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 1.0;
    }

    // Convert value if necessary
    if (!_.isNumber(value)) {
      value = parseFloat(value);
    }

    // TODO: Handle constraints and formats

    break;

  case 'string':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 'Sample text';
    }

    // TODO: Handle constraints and formats

    break;
  }

  return value;
};

var mockResponse = function mockResponse (version, req) {
  var method = req.method.toLowerCase();
  var operation = req.swagger.operation;
  var stubResponse = 'Stubbed response for ' + getHandlerName(version, req);
  var apiDOrSO;
  var composedModel;
  var response;
  var responseCode; // (2.0)
  var responseType;
  var spec;

  switch (version) {
  case '1.2':
    apiDOrSO = req.swagger.apiDeclaration;
    responseType = operation.type;
    spec = require('../lib/specs').v1_2; // jshint ignore:line

    if (spec.primitives.indexOf(operation.type) === -1) {
      responseType = operation.type;
    }

    break;

  case '2.0':
    apiDOrSO = req.swagger.swaggerObject;
    spec = require('../lib/specs').v2_0; // jshint ignore:line

    if (method === 'post' && _.isPlainObject(operation.responses['201'])) {
      responseCode = '201';
    } else if (_.isPlainObject(operation.responses['200'])) {
      responseCode = '200';
    } else if (_.isPlainObject(operation.responses.default)) {
      responseCode = 'default';
    }

    if (!_.isUndefined(responseCode)) {
      responseType = operation.responses[responseCode];
    }

    if (_.isPlainObject(responseType)) {
      if (_.isUndefined(responseType.schema.$ref)) {
        responseType = helpers.toJsonPointer(['paths', req.swagger.apiPath, method, 'responses', responseCode,
                                              'schema']);
      } else {
        responseType = helpers.refToJsonPointer(responseType.schema.$ref);
      }
    }

    break;
  }

  if (_.isUndefined(responseType)) {
    // Should never happen but handle it safely
    response = stubResponse;
  } else if (spec.primitives.indexOf(responseType) === -1) {
    // This is a model
    try {
      composedModel = spec.composeModel(apiDOrSO, responseType);
    } catch (err) {
      response = JSON.stringify({
        message: err.message,
        stack: err.stack
      });
    }

    if (_.isUndefined(composedModel)) {
      response = stubResponse;
    } else {
      response = JSON.stringify(getMockValue(version, composedModel));
    }
  } else {
    // This is a primitive (Only possible in 1.2)
    response = getMockValue(version, operation);
  }

  return response;
};

module.exports.handlerCacheFromDir = function handlerCacheFromDir (dirOrDirs) {
  var handlerCache = {};
  var jsFileRegex = /\.js$/;
  var dirs = [];

  if (_.isArray(dirOrDirs)) {
    dirs = dirOrDirs;
  } else {
    dirs.push(dirOrDirs);
  }

  _.each(dirs, function (dir) {
    _.each(fs.readdirSync(dir), function (file) {
      var controllerName = file.replace(jsFileRegex, '');
      var controller;

      if (file.match(jsFileRegex)) {
        controller = require(path.resolve(path.join(dir, controllerName)));

        if (_.isPlainObject(controller)) {
          _.each(controller, function (value, name) {
            var handlerId = controllerName + '_' + name;

            // TODO: Log this situation

            if (_.isFunction(value) && !handlerCache[handlerId]) {
              handlerCache[handlerId] = value;
            }
          });
        }
      }
    });
  });

  return handlerCache;
};

module.exports.createStubHandler = function createStubHandler (req, res, version) {
  // TODO: Handle headers for 2.0
  // TODO: Handle examples (per mime-type) for 2.0
  // TODO: Handle non-JSON response types

  return function stubHandler (req, res) {
    res.end(mockResponse(version, req));
    // res.end('Stubbed response for ' + getHandlerName(version, req));
  };
};

module.exports.expressStylePath = function expressStylePath (basePath, apiPath) {
  basePath = parseurl({url: basePath || '/'}).pathname || '/';

  // Make sure the base path starts with '/'
  if (basePath.charAt(0) !== '/') {
    basePath = '/' + basePath;
  }

  // Make sure the base path ends with '/'
  if (basePath.charAt(basePath.length - 1) !== '/') {
    basePath = basePath + '/';
  }

  // Make sure the api path does not start with '/' since the base path will end with '/'
  if (apiPath.charAt(0) === '/') {
    apiPath = apiPath.substring(1);
  }

  // Replace Swagger syntax for path parameters with Express' version (All Swagger path parameters are required)
  return (basePath + apiPath).replace(/{/g, ':').replace(/}/g, '');
};

module.exports.send405 = function send405 (req, res) {
  res.statusCode = 405;
  res.end('Route defined in Swagger specification but there is no defined ' + req.method.toLowerCase() +
            ' operation.');
};
