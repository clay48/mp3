/*
 * Helpers shared by the users and tasks routes: error type, query string
 * parsing and request body validation.
 */
var mongoose = require('mongoose');

// An error with an HTTP status and a human readable message for the client
function ApiError(status, message) {
    this.status = status;
    this.message = message;
}

function badRequest(message) {
    return new ApiError(400, message);
}

function notFound(message) {
    return new ApiError(404, message);
}

function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Parse one JSON encoded query string parameter, or return undefined if absent
function parseJsonParam(query, name) {
    var raw = query[name];
    if (raw === undefined || raw === '') return undefined;
    if (typeof raw !== 'string') throw badRequest('Query parameter "' + name + '" must be JSON.');
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw badRequest('Query parameter "' + name + '" is not valid JSON.');
    }
}

function parseObjectParam(query, name) {
    var value = parseJsonParam(query, name);
    if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        throw badRequest('Query parameter "' + name + '" must be a JSON object.');
    }
    return value;
}

function parseIntParam(query, name) {
    var value = parseJsonParam(query, name);
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value < 0) {
        throw badRequest('Query parameter "' + name + '" must be a non-negative integer.');
    }
    return value;
}

// "select" is the documented name; "filter" is accepted as an alias
function parseSelect(query) {
    var select = parseObjectParam(query, 'select');
    return select !== undefined ? select : parseObjectParam(query, 'filter');
}

/*
 * Run GET on a collection with where/sort/select/skip/limit/count, letting
 * Mongoose/MongoDB do the filtering.
 */
async function listDocuments(Model, query, defaultLimit) {
    var where = parseObjectParam(query, 'where') || {};
    var sort = parseObjectParam(query, 'sort');
    var select = parseSelect(query);
    var skip = parseIntParam(query, 'skip');
    var limit = parseIntParam(query, 'limit');
    var count = parseJsonParam(query, 'count');
    if (count !== undefined && typeof count !== 'boolean') {
        throw badRequest('Query parameter "count" must be true or false.');
    }

    var dbQuery;
    try {
        if (count) {
            dbQuery = Model.countDocuments(where);
        } else {
            dbQuery = Model.find(where);
            if (sort) dbQuery.sort(sort);
            if (select) dbQuery.select(select);
            if (limit === undefined) limit = defaultLimit;
        }
        if (skip !== undefined) dbQuery.skip(skip);
        if (limit !== undefined) dbQuery.limit(limit);
    } catch (err) {
        throw badRequest('The query parameters are not valid for this collection.');
    }
    return runQuery(dbQuery);
}

// GET /:id with optional select; malformed and unknown ids are both 404
async function findOneById(Model, id, query, label) {
    var select = parseSelect(query);
    if (!isValidId(id)) throw notFound(label + ' not found.');
    var findQuery = Model.findById(id);
    try {
        if (select) findQuery.select(select);
    } catch (err) {
        throw badRequest('The query parameters are not valid for this collection.');
    }
    var doc = await runQuery(findQuery);
    if (!doc) throw notFound(label + ' not found.');
    return doc;
}

// Errors caused by a bad where/sort/select are the client's fault (400)
async function runQuery(dbQuery) {
    try {
        return await dbQuery.exec();
    } catch (err) {
        if (err instanceof mongoose.Error.CastError ||
            err instanceof mongoose.Error.StrictModeError ||
            err.name === 'MongoServerError') {
            throw badRequest('The query parameters are not valid for this collection.');
        }
        throw err;
    }
}

// Body readers: return the cleaned value, or throw a 400 with a readable message

function readRequiredString(body, field) {
    var value = body[field];
    if (value === undefined || value === null) throw badRequest('Field "' + field + '" is required.');
    if (typeof value !== 'string') throw badRequest('Field "' + field + '" must be a string.');
    value = value.trim();
    if (value === '') throw badRequest('Field "' + field + '" cannot be empty.');
    return value;
}

function readOptionalString(body, field, fallback) {
    var value = body[field];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') throw badRequest('Field "' + field + '" must be a string.');
    return value;
}

function readDate(body, field) {
    var value = body[field];
    if (value === undefined || value === null || value === '') throw badRequest('Field "' + field + '" is required.');
    var date;
    if (typeof value === 'number') date = new Date(value);
    else if (typeof value === 'string') date = /^-?\d+$/.test(value.trim()) ? new Date(Number(value)) : new Date(value);
    if (!date || isNaN(date.getTime())) throw badRequest('Field "' + field + '" must be a valid date.');
    return date;
}

function readBoolean(body, field, fallback) {
    var value = body[field];
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw badRequest('Field "' + field + '" must be true or false.');
}

// A list of ids; form-encoded bodies send a single entry as a plain string
function readIdList(req, field) {
    var value = req.body[field];
    if (value === undefined || value === null) return [];
    if (typeof value === 'string' && req.is('application/x-www-form-urlencoded')) {
        value = value === '' ? [] : [value];
    }
    if (!Array.isArray(value)) throw badRequest('Field "' + field + '" must be a list of ids.');
    var ids = [];
    value.forEach(function (id) {
        if (!isValidId(id)) throw badRequest('Field "' + field + '" contains an invalid id.');
        if (ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
}

module.exports = {
    ApiError: ApiError,
    badRequest: badRequest,
    notFound: notFound,
    isValidId: isValidId,
    listDocuments: listDocuments,
    findOneById: findOneById,
    readRequiredString: readRequiredString,
    readOptionalString: readOptionalString,
    readDate: readDate,
    readBoolean: readBoolean,
    readIdList: readIdList
};
