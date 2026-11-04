var User = require('../models/user.js');
var Task = require('../models/task.js');
var utils = require('./utils.js');

var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/*
 * Validate a user body (name, email, pendingTasks) in the order the API
 * specifies: field format (400), duplicate email (400), unknown tasks (404),
 * completed tasks (400). Nothing is written here.
 */
async function validateUser(req, userId) {
    var name = utils.readRequiredString(req.body, 'name');
    var email = utils.readRequiredString(req.body, 'email');
    if (!EMAIL_PATTERN.test(email)) throw utils.badRequest('Field "email" must be a valid email address.');
    var pendingTasks = utils.readIdList(req, 'pendingTasks');

    var emailQuery = { email: email };
    if (userId) emailQuery._id = { $ne: userId };
    if (await User.exists(emailQuery)) throw utils.badRequest('A user with this email already exists.');

    var tasks = await Task.find({ _id: { $in: pendingTasks } });
    if (tasks.length !== pendingTasks.length) throw utils.notFound('One or more tasks in "pendingTasks" do not exist.');
    if (tasks.some(function (task) { return task.completed; })) {
        throw utils.badRequest('Completed tasks cannot be in "pendingTasks".');
    }

    return { name: name, email: email, pendingTasks: pendingTasks, tasks: tasks };
}

/*
 * Make the tasks agree with a user's new pendingTasks: tasks taken from other
 * users leave their pendingTasks, the listed tasks are assigned to this user,
 * this user's other pending tasks are unassigned, and every task of this user
 * (completed too) gets the current name.
 */
async function syncUserTasks(user, previousOwners) {
    var userId = user._id.toString();
    var otherOwners = previousOwners.filter(function (owner) { return owner && owner !== userId; });
    if (otherOwners.length) {
        await User.updateMany({ _id: { $in: otherOwners } }, { $pull: { pendingTasks: { $in: user.pendingTasks } } });
    }
    await Task.updateMany(
        { assignedUser: userId, completed: false, _id: { $nin: user.pendingTasks } },
        { assignedUser: '', assignedUserName: 'unassigned' }
    );
    await Task.updateMany(
        { $or: [{ _id: { $in: user.pendingTasks } }, { assignedUser: userId }] },
        { assignedUser: userId, assignedUserName: user.name }
    );
}

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        var data = await utils.listDocuments(User, req.query);
        res.status(200).json({ message: 'OK', data: data });
    });

    usersRoute.post(async function (req, res) {
        var fields = await validateUser(req);
        var user = new User({ name: fields.name, email: fields.email, pendingTasks: fields.pendingTasks });
        await user.save();
        await syncUserTasks(user, fields.tasks.map(function (task) { return task.assignedUser; }));
        res.status(201).json({ message: 'User created', data: user });
    });

    userRoute.get(async function (req, res) {
        var user = await utils.findOneById(User, req.params.id, req.query, 'User');
        res.status(200).json({ message: 'OK', data: user });
    });

    userRoute.put(async function (req, res) {
        var user = utils.isValidId(req.params.id) ? await User.findById(req.params.id) : null;
        if (!user) throw utils.notFound('User not found.');
        var fields = await validateUser(req, user._id);

        user.name = fields.name;
        user.email = fields.email;
        user.pendingTasks = fields.pendingTasks;
        await user.save();
        await syncUserTasks(user, fields.tasks.map(function (task) { return task.assignedUser; }));
        res.status(200).json({ message: 'User updated', data: user });
    });

    userRoute.delete(async function (req, res) {
        var user = utils.isValidId(req.params.id) ? await User.findById(req.params.id) : null;
        if (!user) throw utils.notFound('User not found.');
        await User.deleteOne({ _id: user._id });
        await Task.updateMany({ assignedUser: user._id.toString() }, { assignedUser: '', assignedUserName: 'unassigned' });
        res.status(204).end();
    });

    return router;
};
