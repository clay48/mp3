var User = require('../models/user.js');
var Task = require('../models/task.js');
var utils = require('./utils.js');

/*
 * Validate a task body in the order the API specifies: field format (400),
 * unknown assigned user (404), assignedUserName mismatch (400). Nothing is
 * written here.
 */
async function validateTask(req) {
    var body = req.body;
    var fields = {
        name: utils.readRequiredString(body, 'name'),
        deadline: utils.readDate(body, 'deadline'),
        description: utils.readOptionalString(body, 'description', ''),
        completed: utils.readBoolean(body, 'completed', false),
        assignedUser: utils.readOptionalString(body, 'assignedUser', '').trim()
    };
    var assignedUserName = utils.readOptionalString(body, 'assignedUserName', '');

    if (fields.assignedUser === '') {
        if (assignedUserName !== '' && assignedUserName !== 'unassigned') {
            throw utils.badRequest('"assignedUserName" must be "unassigned" when the task has no assigned user.');
        }
        fields.assignedUserName = 'unassigned';
        return fields;
    }

    if (!utils.isValidId(fields.assignedUser)) throw utils.badRequest('Field "assignedUser" is not a valid id.');
    var user = await User.findById(fields.assignedUser);
    if (!user) throw utils.notFound('The assigned user does not exist.');
    if (assignedUserName !== '' && assignedUserName !== user.name) {
        throw utils.badRequest('"assignedUserName" does not match the name of the assigned user.');
    }
    fields.assignedUserName = user.name;
    return fields;
}

// Make users' pendingTasks agree with the task's assignment and completion
async function syncTaskUsers(task) {
    var taskId = task._id.toString();
    var others = { pendingTasks: taskId };
    if (task.assignedUser) others._id = { $ne: task.assignedUser };
    await User.updateMany(others, { $pull: { pendingTasks: taskId } });

    if (task.assignedUser) {
        var update = task.completed ? { $pull: { pendingTasks: taskId } } : { $addToSet: { pendingTasks: taskId } };
        await User.updateOne({ _id: task.assignedUser }, update);
    }
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        var data = await utils.listDocuments(Task, req.query, 100);
        res.status(200).json({ message: 'OK', data: data });
    });

    tasksRoute.post(async function (req, res) {
        var fields = await validateTask(req);
        var task = new Task(fields);
        await task.save();
        await syncTaskUsers(task);
        res.status(201).json({ message: 'Task created', data: task });
    });

    taskRoute.get(async function (req, res) {
        var task = await utils.findOneById(Task, req.params.id, req.query, 'Task');
        res.status(200).json({ message: 'OK', data: task });
    });

    taskRoute.put(async function (req, res) {
        var task = utils.isValidId(req.params.id) ? await Task.findById(req.params.id) : null;
        if (!task) throw utils.notFound('Task not found.');
        var fields = await validateTask(req);

        task.set(fields);
        await task.save();
        await syncTaskUsers(task);
        res.status(200).json({ message: 'Task updated', data: task });
    });

    taskRoute.delete(async function (req, res) {
        var task = utils.isValidId(req.params.id) ? await Task.findById(req.params.id) : null;
        if (!task) throw utils.notFound('Task not found.');
        await Task.deleteOne({ _id: task._id });
        await User.updateMany({ pendingTasks: task._id.toString() }, { $pull: { pendingTasks: task._id.toString() } });
        res.status(200).json({ message: 'Task deleted', data: task });
    });

    return router;
};
