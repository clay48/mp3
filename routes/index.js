/*
 * Connect all of your endpoints together here.
 */
var utils = require('./utils.js');

module.exports = function (app, router) {
    require('./users.js')(router);
    require('./tasks.js')(router);
    app.use('/api', require('./home.js')(router));

    // Unknown endpoints
    app.use(function (req, res) {
        res.status(404).json({ message: 'Endpoint not found', data: {} });
    });

    // Turn every error into a { message, data } response without leaking Mongoose/MongoDB details
    app.use(function (err, req, res, next) {
        if (err instanceof utils.ApiError) {
            return res.status(err.status).json({ message: err.message, data: {} });
        }
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ message: 'The request body is not valid JSON.', data: {} });
        }
        if (err.code === 11000) {
            return res.status(400).json({ message: 'A user with this email already exists.', data: {} });
        }
        if (err.name === 'ValidationError' || err.name === 'CastError') {
            return res.status(400).json({ message: 'The request contains invalid fields.', data: {} });
        }
        console.error(err);
        res.status(500).json({ message: 'Something went wrong on the server. Please try again later.', data: {} });
    });
};
