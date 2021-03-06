var TankController = Controller.extend({
    routes: function(){
        // Controller initialised on app.ready - see controllers/controllers.js
        var hubs = app.slugs.hubs,
            tasks = app.slugs.tasks,
            routes = {};
        
        routes["/"] = "resetHubs";
        routes["/"+hubs+"/new/"] = "newHub";
        routes["/"+hubs+"/archived/"] = "listArchivedHubs";
        routes["/"+hubs+"/:id/"] = "displayHub";
        routes["/"+hubs+"/:id/edit/"] = "editHub";
        routes["/"+hubs+"/:id/"+tasks+"/new/"] = "newTask";
        routes["/"+hubs+"/:id/"+tasks+"/:taskId/edit/"] = "editTask";
        routes["/"+hubs+"/:id/"+tasks+"/:taskId/"] = "displayTaskDetails";
        routes["/"+hubs+"/:id/detail/"] = "displayHubDetails";
        
        return routes;
    },
    
    clientUrl: function(model, includeHash){
        var slugs = app.slugs,
            path;
        
        if (!model || model.isNew()){
            return null;
        }
        
        switch (model.type){
            case "hub":
            path = slugs.hubs;
            break;
            
            case "task":
            path = slugs.hubs + "/" + model.get("hub") + "/" + slugs.tasks;
            break;
            
            case "user":
            path = slugs.users;
            break;
            
            default:
            return null;
        }
        
        return (includeHash ? "#" : "") +
            "/" + path + "/" + model.id + "/";
    },

    constructor: function TankController() {
        Controller.apply(this, arguments);
    },

    initialize: function(options){
        var tank = this;

        this.hubViews = {};
        this.window = jQuery(window);

        _.bindAll(this, "_onSelectHubs", "_onDeselectHubs", "repositionHubs");

        // Hack to check if we're loading a hub when this class is intialised
        // as we don't want to scroll to a hub on load in #displayHub().
        this._isHubUrlOnLoad = window.location.hash.slice(2, 6) === "hubs";

        this.scrollbarWidth = this.getScrollbarWidth();
        this.svg = this.createSVGRoot(jQuery("#vector")[0]);

        // Force director
        this.forceDirector = ForceDirector.create({
            animate: app.animateHubs
        });

        this.forceDirector
            .bind("loop", this.repositionHubs)
            .bind("end", this.repositionHubs)
            // TODO: tasks views don't position correctly on re-paint
            .bind("end", function(){
                // Redraw taskviews
                if (app.selectedHubView && app.selectedHubView.taskViews){
                    app.selectedHubView.redrawTasks();
                }
            });

        _.bindAll(this, "updateMarkers");
        this.tankView = new Tank({el: jQuery("body")[0]});

        this.bind("change:walls", function(tank, dimensions){
            var currentWalls = this.forceDirector.getWalls();

            if (!_.isEqual(currentWalls, dimensions)){
                this.updateSVGDimensions();
                this.forceDirector.setWalls(dimensions);
                this.calculateHubWeights();
            }
        });

        this.bind("resize", function(){
            this.updateWalls().repositionHubViews();
        });

        jQuery(window).bind("resize", _.debounce(function(){
            tank.trigger("resize", tank);
        }, app.tankResizeThrottle));

        app.dashboard.bind("all", function (eventName, dashboard) {
            if (eventName === "show" || eventName === "hide") {
                if (dashboard.isAnimating() && eventName === "show") {
                    dashboard.bind("animated", function onAnimated() {
                        dashboard.unbind("animated", onAnimated);
                        this.markersView.toggleFullscreen(eventName === "hide");
                    }, this);
                } else {
                    this.markersView.toggleFullscreen(eventName === "hide");
                }
            }
        }, this);

        Tasket.hubs
            // Watch for new hubs and add them to the tank.
            .bind("add", _.bind(function(hub){
                // If the hub isn't yet shown in the tank, and it still has unverified tasks
                if (!this.getHubView(hub.id) && hub.isOpen()){
                    this.addHub(hub);
                }
            }, this))
            // Remove tasks from global collection when hubs are removed
            .bind("remove", _.bind(function(hub){
                hub.forEachTask(function(taskId){
                    Tasket.tasks.remove(taskId);
                });
            }, this));

/*
        Tasket.tasks
            // When a task is removed from the global collection, clean up by removing task from its hub model, and the associated users.
            // TODO: this should be distributed into the user/hub models
            .bind("remove", _.bind(function(task){
                var users = Tasket.users,
                    hub = Tasket.hubs.get(task.get("hub")),
                    owner = users.get(task.get("owner")),
                    claimedBy = users.get(task.get("claimedBy")),
                    doneBy = users.get(task.get("doneBy")),
                    verifiedBy = users.get(task.get("verifiedBy"));

                if (hub){
                    hub.removeTask(task); // NOTE: currently this causes the hub total estimate to be adjusted twice when removing a task
                }

                if (owner){
                    owner.removeTask(task);
                }

                if (claimedBy){
                    claimedBy.removeTask(task);
                }

                if (doneBy){
                    doneBy.removeTask(task);
                }

                if (verifiedBy){
                    verifiedBy.removeTask(task);
                }
            }, this));
   */

        this.updateWalls();
        this.centerTank();

        // Create controller to handle hub navigation markers.
        this.markersView = new HubMarkers();
        this.markersView.toggleFullscreen(app.dashboard.isHidden());

        this.markersView.bind("selected", function (markerView) {
            var hubView = this.hubViews[markerView.model.cid];

            if (hubView && hubView.isSelected()) {
                this.centerViewportOnHub(hubView);
            } else {
                // Just update the hash fragment to jump to the selected hub.
                this.navigate("/" + app.slugs.hubs + "/:id/".replace(":id", markerView.model.id), true);
            }
        }, this);
        this._setupPanAndScrollEvents();

        // Hide markers when showing lightbox.
        app.lightbox.bind("show", this.markersView.hide, this.markersView);

        this.bind("add:hub", function (controller, hub, hubView) {
            this.addMarker(hub);
        }, this.markersView);

        jQuery("body").append(this.markersView.render());

        // Add hubs
        if (options && options.hubs){
            this.addHubs(options.hubs);
        }
    },

    _setupPanAndScrollEvents: function () {
        var throttledUpdateMarkers = _.throttle(this.updateMarkers, 1000 / 60),
            toggleDisplayMarkers, isPanning;

        // Move viewport and update markers when panned.
        this.tankView.bind("pan", this.shiftViewport, this);
        this.tankView.bind("pan", throttledUpdateMarkers);
        jQuery(window).scroll(throttledUpdateMarkers);

        // Handler to show the markers when the view is scrolled/panned and
        // will hide the markers when idle. If a marker is moused over the
        // timer will be cancelled until mouseleave.
        toggleDisplayMarkers = (function (markersView) {
            var timer;

            function startTimer() {
                timer = setTimeout(function () {
                    isPanning = false;
                    markersView.hide();
                }, 2000);
            }

            function stopTimer() {
                clearTimeout(timer);
            }

            markersView.bind("mouseenter", stopTimer);
            markersView.bind("mouseleave", startTimer);

            return function () {
                if (!app.lightbox.isHidden()) {
                    return;
                }

                if (!isPanning) {
                    markersView.show();
                    isPanning = true;
                }

                stopTimer();
                startTimer();
            };
        })(this.markersView);

        // Bind this handler to scroll and pan.
        this.tankView.bind("pan", toggleDisplayMarkers);
        jQuery(window).scroll(toggleDisplayMarkers);

        // Watch the viewport bounds. If the user mouses into these bounds
        // and is not panning display the markers. This allows the user to
        // interact with the markers when not panning.
        jQuery("body").mousemove(_.throttle(_.bind(function (event) {
            if (!app.lightbox.isHidden()) {
                return;
            }

            var bound       = 30,
                width       = this.viewportWidth - this.getDashboardWidth(),
                mouseTop    = event.clientY,
                mouseleft   = event.clientX,
                boundTop    = bound + app.toolbar.elem.outerHeight(true),
                boundLeft   = bound,
                boundRight  = width - bound,
                boundBottom = this.viewportHeight - bound;

            if (mouseTop < boundTop || mouseTop > boundBottom ||
                mouseleft < boundLeft || (mouseleft > boundRight && mouseleft < width)) {
                if (!isPanning) {
                    this.markersView.show();
                }
            } else {
                if (!isPanning) {
                    this.markersView.hide();
                }
            }
        }, this), 200));
    },

    error: function (message) {
        app.notification.error(
            message || "You do not have permission to access this."
        );
        app.back();

        return this;
    },

    getHubView: function(id){
        id = String(id); // allow argument to be a String or a Number

        return _(this.hubViews).detect(function(hubView){
            return id === hubView.model.id;
        });
    },

    /*
    getTaskView: function(id){
        id = String(id); // allow argument to be a String or a Number

        var task = Tasket.getTasks(id),
            hubId = task && task.get("hub"),
            hubView = hubId && this.getHubView(hubId);

        return hubView && hubView.taskViews && hubView.taskViews.detect(function(taskView){
            return taskView.model.id === id;
        });
    },
    */

    centerViewportOnHub: function (hubView) {
        this.centerViewport(hubView.getCenter(), {
            animate: Backbone.history.stack().length > 0 || !this._isHubUrlOnLoad
        });
    },

    // When a hubView is selected, then deselect all the other hubviews
    _onSelectHubs: function(selectedHubView){
        _(this.hubViews)
            .chain()
            .reject(function(hubView){
                return hubView.model.id === selectedHubView.model.id;
            })
            .invoke("deselect");

        this.centerViewportOnHub(selectedHubView);

        return this.trigger("hub:select", selectedHubView, this);
    },

    _onDeselectHubs: function(hubView){
        return this.trigger("hub:deselect", hubView, this);
    },

    renderHubView: function (hubView) {
        app.bodyElem.append(hubView.elem);
        hubView.render();
        return this;
    },

    drawHubView: function(hubView, options){
        var offset;

        options = options || {};

        if (_.isNumber(options.left) && _.isNumber(options.top)){
            offset = {
                left: options.left,
                top: options.top
            };
        }
        else {
            offset = this.hubViewOffset(hubView);
        }

        hubView.offsetValues(offset);

        // Add the hub to the forcedirector engine (not a task, even though the method is `addTask`)
        hubView.forcedNodeHubToHub = this.forceDirector.createNode({
            key: "hub-" + hubView.model.id,
            x: offset.left - hubView.nucleusWidth * 1.5,
            y: app.invertY(offset.top),
            width: hubView.width + app.hubBuffer * 2,
            height: hubView.height + app.hubBuffer * 2,
            title: hubView.model.get("title")
        });

        return this;
    },

    addHubs: function(hubs, options){
        var tank = this,
            hubViewOptions;

        _(hubs).each(function(hub){
            if (!hub.get("archived.timestamp")) { //TODO: remove when archived projects aren't passed through default API /hubs/ call
                this.addHub(hub, {dontDraw:true});
            }
        }, this);

        if (!options || !options.dontDraw){
            this.calculateHubWeights();

            _.each(this.hubViews, this.renderHubView, this);

            this.updateWalls();

            _.each(this.hubViews, this.drawHubView, this);
            
            // Tank size is based on hubs.
            this.forcedirectHubs();
        }

        return this;
    },

    addHub: function(hub, options){
        var hubView = this.getHubView(hub.id),
            offset;

        if (hubView) {
            return hubView;
        }

        options = options || {};

        hubView = this.hubViews[hub.cid] = new HubView({
            model: hub
        });

        hubView
            .bind("select", this._onSelectHubs)
            .bind("deselect", this._onDeselectHubs)
            .bind("change:position:tasks", _.bind(function(hubView){
                this.trigger("change:position:tasks", this, hubView);
            }, this));

        if (!options.dontDraw){
            this.calculateHubWeights()
                .renderHubView(hubView)
                .drawHubView(hubView)
                .forcedirectHubs();
        }
        this.trigger("add:hub", this, hub, hubView);

        return hubView;
    },

    // Remove a hub from the tank.
    removeHubView: function (hub) {
        var hubView = this.getHubView(hub.id);

        if (hubView) {
            delete this.hubViews[hub.cid];
            hubView.deselect().remove();

            this.removeForceDirectorNode("hub-" + hub.id)
                .calculateHubWeights()
                .forcedirectHubs();
        }

        return this;
    },

    resetHubs: function () {
        _.invoke(this.hubViews, "deselect");
        this.centerTank({
            animate: !!Backbone.history.stack().length
        });
    },

    displayHub: function(hubId){
        var controller = this,
            hubView = this.getHubView(hubId),
            position;

        if (hubView){
            hubView.sendToFront().showTasks();
        }

        return this;
    },

    newHub: function(){
        var hub;

        if (!this._isLoggedIn("You must be logged in to create a " + app.lang.HUB)) {
            return;
        }

        hub = new Hub({
            owner: app.currentUser.id
        });

        this._createHubForm(hub)
            .bind("success", _.bind(function (hub) {
                // Add hubs to global cache.
                Tasket.hubs.add(hub);

                // Add hub and select it for viewing
                this.addHub(hub).select();
            }, this));

        return this;
    },

    listArchivedHubs: function() {
        var form = new ArchiveForm();

        // open view in lightbox
        function renderArchivedHubs(hubs){
            var archivedHubData = [],
                hubsLength = hubs.models.length;

            _.each(hubs.models, function(hub){
                var taskCount = hub.countTasks(),
                    completedTaskCount = hub.countCompletedTasks(),
                    date = timestampToRelativeDate(hub.get("archived.timestamp")),
                    hasDate = !!date;

                archivedHubData.push({
                    id: hub.id,
                    title: hub.get("title"),
                    hasDate: hasDate,
                    date: date,
                    taskCount: taskCount +
                        " task" + ((taskCount !== 1) ? "s" : "") +
                        " (" + completedTaskCount + " completed)"
                });
            });

            app.lightbox.content(form.render(archivedHubData).el, "archived-hubs").show();

            // When user clicks on "Restore" to un-archive a hub
            form.bind("restoreHub", _.bind(function (hubId) {
                var hub = Tasket.getHubs(hubId);

                if (!hub){
                    this.error("Sorry. There was a problem editing the " + app.lang.HUB + ". Please refresh the page and try again. (error: hub-" + hubId + " not found)");
                    return;
                }
                hub.unarchive();
                this.addHub(hub).select();
                // TODO: re-render dashboard list of projects

                hubsLength -= 1;

                if (!hubsLength){
                    app.lightbox.hide();
                }
            }, this));
        }

        Tasket.getArchivedHubs(_.bind(renderArchivedHubs, this));
        return form;
    },

    editHub: function (hubId) {
        var hub = Tasket.getHubs(hubId),
            hubView;

        if (!hub){
            this.error("Sorry. There was a problem editing the " + app.lang.HUB + ". Please refresh the page and try again. (error: hub-" + hubId + " not found)");
            return;
        }

        if (!this._isLoggedIn("You must be logged in to edit this.")) {
            return;
        }
        if (!this._hasAdminRights(hub.get("owner"), "You cannot edit this, because you do not own it and you are not an admin.")) {
            return;
        }

        this._createHubForm(hub)
            .bind("success", _.bind(function (hub) {
                hubView = this.getHubView(hubId);
                if (hubView){
                    hubView.render();
                }
            }, this));

        return this.displayHub(hubId);
    },

    _isLoggedIn: function (message) {
        if (!app.currentUser) {
            this.error(message || "You must be logged in");
        }
        return !!app.currentUser;
    },

    _hasAdminRights: function (id, message) {
        var hasRights = app.isCurrentUser(id) || app.currentUserIsAdmin();
        if (!hasRights) {
            this.error(message || "Sorry, you do not have permission to do that.");
        }
        return hasRights;
    },

    _createHubForm: function (hub) {
        var form = new HubForm({
            model: hub
        });

        app.lightbox.content(form.render().el, "create-hub-form").show();

        // Append our iFrame element for upload.
        form.updateFrame();

        form.bind("success", function (hub) {
                app.lightbox.hide();
                HubView.prototype.updateLocation.call({model:hub});
            })
            .bind("archive", _.bind(function (hub) {
                this.removeHubView(hub);
                app.lightbox.hide();
                this.navigate("/", true);
            }, this))
            .bind("delete", _.bind(function (hub) {
                this.removeHubView(hub);
                Tasket.hubs.remove(hub);
                app.lightbox.hide();
                this.navigate("/", true);
            }, this))
            .bind("error", _.bind(function(hub, form, status){
                this.error("Sorry, there was an error creating the " + app.lang.HUB + ". Please try logging out and in again. (error: hub-" + hub.id + ", status " + status + ")");
            }, this));

        return form;
    },

    // TODO: this should work even when the task view isn't yet available - i.e. via an async request to API
    // TODO: lightbox should close if a link from within the task description is clicked
    displayHubDetails: function(hubId){
        var hubView = this.getHubView(hubId);

        if (hubView){
            hubView.select().displayDetails();
        }

        return this;
    },

    // TODO: this should work even when the task view isn't yet available - i.e. via an async request to API
    // TODO: lightbox should close if a link from within the task description is clicked
    displayTaskDetails: function(hubId, taskId){
        taskId = String(taskId); // allow argument to be a String or a Number

        var hubView = this.getHubView(hubId),
            taskView = hubView && hubView.taskViews && hubView.taskViews.detect(function(taskView){
                return taskView.model.id === taskId;
            });

        if (taskView){
            this.displayHub(hubId);
            taskView.displayDetails();
        }
        else if (hubView){
            hubView.updateLocation();
        }

        return this;
    },

    newTask: function(hubId){
        var hub = Tasket.getHubs(hubId),
            form;

        if (!hub){
            this.error("Sorry. There was a problem creating the task. Please refresh the page and try again. (error: hub-" + hubId + " not found)");
            return;
        }

        if (!this._isLoggedIn("You must be logged in to create a task.")) {
            return;
        }

        if (!this._hasAdminRights(hub.get("owner"), "You cannot create a task here on this " + app.lang.HUB + ", because you do not own it and you are not an admin.")) {
            return;
        }

        if (!hub.canAddTask()) {
            this.error("A " + app.lang.HUB + " can only have a maximum of " + Tasket.settings.TASK_LIMIT + " incomplete tasks");
            return;
        }

        return this.displayHub(hubId)
            ._createTaskForm(hub, new Task({
                hub: hubId, // NOTE: Verify this when refactoring hubs.
                owner: app.currentUser.id,
                estimate: Task.ESTIMATES[0].value
            }));
    },

    editTask: function (hubId, taskId) {
        var hub  = Tasket.getHubs(hubId),
            task = Tasket.getTasks(taskId);

        if (_.indexOf(hub.getTasks(), taskId) < 0) {
            this.error("That task does not exist on this " + app.lang.HUB + ".");
            app.lightbox.hide();
            return;
        }

        if (!this._isLoggedIn("You must be logged in to create a task.")) {
            app.lightbox.hide();
            return;
        }

        if (!this._hasAdminRights(hub.get("owner"), "You do not own this " + app.lang.HUB + ".")) {
            app.lightbox.hide();
            return;
        }

        return this._createTaskForm(hub, task);
    },

    _createTaskForm: function (hub, task) {
        var form = new TaskForm({model: task}),
            tank = this;

        app.lightbox.content(form.render().el, "create-task-form").show();
        form.bind("success", _.bind(function (event) {
                var hubView = tank.getHubView(hub.id),
                    userTasks;

                app.lightbox.hide({silent: true});

                // Add task to Tasket.tasks collection if not already in there.
                if (!Tasket.tasks.get(task.id)) {
                    Tasket.tasks.add(task);
                    hub.addTask(task);
                }

                // Add to current users tasks if not already in there.
                if (
                  task.get("state") === Task.states.NEW &&
                  task.get("owner") === app.currentUser.id
                ) {
                    userTasks = _.clone(app.currentUser.get("tasks.owned.new"));
                    userTasks.push(task.id);
                    app.currentUser.set({
                      "tasks.owned.new": userTasks
                    });
                }

                tank.repositionHubViews();

                // Go to the hub's URL
                hubView.updateLocation();
            }, this))
            .bind("delete", _.bind(function (model) { // TODO create removeTask method
                var hubView = this.getHubView(hub.id);
                if (hubView) {
                    hubView.model.removeTask(task);
                }
                app.currentUser.removeTask(model);
                Tasket.tasks.remove(model);
                app.lightbox.hide();
            }, this))
            .bind("error", _.bind(function(task, form, status){
                this.error("Sorry, there was an error creating the task. Please try logging out and in again. (error: task-" + task.id + ", status " + status + ")");
            }));

        return this;
    },


    /////

    // FORCE-DIRECTION PHYSICS
    // TODO: totally refactor these, and related methods in hub-view.js

    removeForceDirectorNode: function(key){
        if (this.forceDirector){
            this.forceDirector.nodes = _.reject(this.forceDirector.nodes, function(node){
                return node.key === key;
            });
        }
        return this;
    },
    
    totalHubEstimate: function(){
        var hubEstimates = Tasket.hubs.invoke("estimate");
        return _.reduce(hubEstimates, function(memo, value){return memo + value;}, 0);
    },
    
    getWeightForHub: function(hub){
        var settings = Tasket.settings,
            // (max minutes per task * max new, claimed or done tasks on a hub) / 3 = max minutes per task type - i.e. new, claimed or done tasks
            //maxMinutesPerUnverifiedTaskType = (settings.TASK_ESTIMATE_MAX * settings.TASK_LIMIT) / 3,
            
            maxMinutesPerUnverifiedTaskType = this.totalHubEstimate() / 3,
            
            unverifiedTaskWeight = hub.get("estimates.new") +
                (hub.get("estimates.claimed") / 2) +
                (hub.get("estimates.done") / 4),
                
            maxUnverifiedTaskWeight = maxMinutesPerUnverifiedTaskType +
                (maxMinutesPerUnverifiedTaskType / 2) +
                (maxMinutesPerUnverifiedTaskType / 4),
            
            numVerifiedTasks = hub.get("estimates.verified"),
            verifiedTaskAdjustment = numVerifiedTasks ? (0.5 / numVerifiedTasks) : 1,
            maxVerifiedTaskAdjustment = 1,
            
            minutesThisHub = unverifiedTaskWeight + verifiedTaskAdjustment,
            maxMinutes = maxUnverifiedTaskWeight + maxVerifiedTaskAdjustment;
            
        return minutesThisHub ?
            minutesThisHub / maxMinutes : 0;
    },

    getHubWeights: function(){
        return _.map(this.hubViews, function(hubView){
            return this.getWeightForHub(hubView.model);
        }, this);
    },

    calculateHubWeights: function(){
        var hubWeights = this.hubWeights = this.getHubWeights(),
            totalHubViews;

        this.hubWeightMin = Math.min.apply(Math, hubWeights);
        this.hubWeightMax = Math.max.apply(Math, hubWeights);
        this.hubWeightRange = this.hubWeightMax - this.hubWeightMin;
        this.hubViewOrderX = this.hubsAlphabetical();
        this.hubViewOrderXSlice = this.width / this.hubViewOrderX.length;

        return this;
    },

    hubViewOffsetTop: function(hubView){
        if (_.isUndefined(this.hubWeights)){
            throw "tank.hubViewOffsetTop: Must call tank.calculateHubWeights() first";
        }

        var weight = this.getWeightForHub(hubView.model),
            weightRatioOfFullRange = (weight - this.hubWeightMin) / (this.hubWeightRange || 0.5); // 0.5 is to supply a number for when there is no difference at all

        return weightRatioOfFullRange * (this.height - this.marginTop - 90) + this.marginTop + 90; // 90 is expected hubView height
    },

    hubViewOffsetLeft: function(hubView){
        return this.hubViewOrderX.length < 2 ?
            this.wallLeft + this.width / 2 :
            this.wallLeft + this.hubViewOrderXSlice / 2 + (this.hubViewOrderXSlice * _.indexOf(this.hubViewOrderX, hubView.model.id)) + Math.random(); // random seed
    },

    hubsAlphabetical: function(){
        return _(this.hubViews).chain()
            .sortBy(function(hubView){
                var title = hubView.model.get("title") || hubView.model.get("description");
                return title.toLowerCase();
            })
            .map(function(hubView){
                return hubView.model.id;
            })
            .value();
    },

    hubViewOffset: function(hubView){
        return {
            left: this.hubViewOffsetLeft(hubView),
            top:  this.hubViewOffsetTop(hubView)
        };
    },

    setHubViewOffsetFromForcedNode: function(hubView){
        var node = hubView.forcedNodeHubToHub,
            pos = node.getPos();

        hubView.offset({
            left: ~~(pos.x - node.width / 2 + hubView.nucleusWidth / 2), // NOTE: ~~n === Math.floor(n)
            top: app.invertY(~~pos.y)
        });
    },

    repositionHubViews: function(){
        var tank = this;

        _(this.hubViews).each(function(hubView){
            var offsetTop = tank.hubViewOffsetTop(hubView),
                forcedNode = hubView.forcedNodeHubToHub;

            // Set position of force-directed representation, with respect to other hubs
            forcedNode.setPos(
                forcedNode.getPos().x,
                app.invertY(offsetTop)
            );

            // Set position of DOM element
            tank.setHubViewOffsetFromForcedNode(hubView);

            // Set position of force-directed representation, with respect to tasks - TODO: combine these
            hubView.updateForceDirectedDimensions();
        });

        return this.forcedirectHubs();
            //.forcedirectTasks(); // TODO: not currently working (canvas lines move out of sync)
    },

    repositionHubs: function(){
        _.each(this.hubViews, this.setHubViewOffsetFromForcedNode);
        return this.trigger("change:position:hubs");
    },

    forcedirectHubs: function(){
        this.forceDirector.go();
        return this;
    },

    forcedirectTasks: function(){
        _.each(this.hubViews, function(hubView){
            if (hubView.taskViews){
                hubView.refreshTasks();
            }
        });
        return this;
    },

    forcedirectAll: function(){
        return this
            .forcedirectHubs()
            .forcedirectTasks();
    },

    updateViewport: function () {
        var $window = jQuery(window);

        this.viewportWidth  = $window.width()  - this.scrollbarWidth;
        this.viewportHeight = $window.height() - this.scrollbarWidth;

        if (this.viewportWidth < 0){
            this.viewportWidth = 0;
        }

        if (this.viewportHeight < 0){
            this.viewportHeight = 0;
        }
    },

    /* Public: Determine the tank dimensions by splitting the hubs into
     * into groups based on thier weight. The width is determined by the
     * group with the most hubs multiplied by the hub width. The height is
     * determined by the number of groups that contains hubs multiplied
     * by the height.
     *
     * Returns nothing.
     */
    updateTank: function () {
        // Work out how big we want the tank and set the dimensions.
        var groups = [],
            groupCount = 5,
            groupWeight, weights,
            viewportRatio = this.viewportWidth / this.viewportHeight,
            hubWidth, hubHeight, tankWidth, tankHeight, tankArea;

        // If we have no hubs yet just use the viewport dimensions.
        if (_.size(this.hubViews)) {
            // Split the range of hub weights into groups.
            groupWeight = this.hubWeightRange / groupCount;

            // Assign the hubs to groups.
            _.each(this.hubViews, function (view) {
                var weight = this.getWeightForHub(view.model),
                    group  = Math.floor(weight / groupWeight),
                    array  = groups[group];

                if (!array) {
                    array =  groups[group] = [];
                }

                array.push(view);

                if (!hubWidth) {
                    // Grab the hub width/height for use when resizing.
                    hubWidth  = view.width;
                    hubHeight = view.height;
                }
            }, this);

            // If we have hubs in the DOM with dimensions.
            if (hubWidth && hubHeight) {
                // Remove empty groups.
                groups = _.compact(groups);

                // width == max number of hubs in group * hub width
                tankWidth  = Math.max.apply(Math, _.pluck(groups, "length")) * hubWidth * 1.25;

                // height == number of groups containing hubs * hub height
                // this is multiplied by 2 to give a little more height between the
                // hubs. The 2 is arbitrary and assigned through trial and error.
                tankHeight = groups.length * (hubHeight * 2);
                
                tankArea = tankWidth * tankHeight;
                tankWidth = Math.sqrt(tankArea / viewportRatio);
                tankHeight = tankArea / tankWidth;
                
                // Spread to viewport ratio
                this.tankWidth = tankWidth;
                this.tankHeight = tankHeight;
            }
        }

        // Default to the viewport width/height.
        if (!this.tankHeight || this.tankHeight < this.viewportHeight) {
            this.tankHeight = this.viewportHeight;
        }

        if (!this.tankWidth || this.tankWidth < this.viewportWidth) {
            this.tankWidth  = this.viewportWidth;
        }

        jQuery("body").width(this.tankWidth).height(this.tankHeight);
    },

    getViewportCenter: function () {
        var visibleArea = this.markersView.getBounds();
        return {
            left: visibleArea.left + (visibleArea.width  / 2),
            top:  visibleArea.top  + (visibleArea.height / 2)
        };
    },

    // Centers the viewport in the middle of the tank.
    centerTank: function (options) {
        this.centerViewport({
            top:  this.tankHeight / 2,
            left: this.tankWidth  / 2
        }, options);
    },

    // Centres the viewport around the x, y position.
    centerViewport: function (offset, options) {
        // Take into account the dashboard sidebar
        var centerX = (this.viewportWidth - this.getDashboardWidth()) / 2,
            centerY = this.viewportHeight / 2;

        this.positionViewport({
            top:  offset.top  - centerY,
            left: offset.left - centerX
        }, options);
    },

    // Shifts viewport by increments provided.
    shiftViewport: function (offset, options) {
        var currentY = this.window.scrollTop(),
            currentX = this.window.scrollLeft();

        this.positionViewport({
            top:  currentY - offset.top,
            left: currentX - offset.left
        }, options);
    },

    // Positions the viewport top/left from the document.
    positionViewport: function (offset, options) {
        var offsetX = offset.left > 0 ? offset.left : 0,
            offsetY = offset.top  > 0 ? offset.top  : 0;

        if (options && options.animate) {
            // Webkit requires "body", Firefox "html".
            jQuery("html, body").animate({
                scrollTop:  offsetY,
                scrollLeft: offsetX
            });
        } else {
            window.scrollTo(offsetX, offsetY);
        }
    },

    // Get the dimensions of the tank
    updateWalls: function(){
        var toolbarHeight = app.toolbar.elem.outerHeight(true),
            wallBuffer = app.wallBuffer,
            dimensions;

        this.updateViewport();
        this.updateTank();

        this.wallBuffer = wallBuffer;

        // NOTE: this is zero-bottom y
        this.wallTop    = this.tankHeight - wallBuffer - toolbarHeight;
        this.wallLeft   = wallBuffer;
        this.wallRight  = this.tankWidth - this.getDashboardWidth() - wallBuffer;
        this.wallBottom = wallBuffer;

        this.width     = this.wallRight  - this.wallLeft;
        this.height    = this.wallTop    - this.wallBottom;
        this.marginTop = this.tankHeight - this.wallTop;

        dimensions = {
            top: this.wallTop,
            left: this.wallLeft,
            right: this.wallRight,
            bottom: this.wallBottom
        };

        return this.trigger("change:walls", this, dimensions);
    },

    // Gets the width of the dashboard including the right offset.
    getDashboardWidth: function () {
        if (app.dashboard.isHidden()) {
            return 0;
        }
        return app.dashboard.elem.outerWidth() + parseFloat(app.dashboard.elem.css("right"));
    },

    // Modified from http://fleegix.org/articles/2006-05-30-getting-the-scrollbar-width-in-pixels
    getScrollbarWidth: function(){
        var // Outer scrolling div
            outer = jQuery("<div/>").css({
                position: "absolute",
                top: "-1000px",
                left: "-1000px",
                width: "100px",
                height: "50px",
                overflow: "hidden"
            }).appendTo("body"),

            // Inner content div
            inner = jQuery("<div/>").css({
                width: "100%",
                height: "200px"
            }).appendTo(outer),

            // Width of the inner div without scrollbar
            width1 = inner[0].offsetWidth,
            width2;

        // Width of the inner div with scrollbar
        outer.css({overflow: "auto"});
        width2 = inner[0].offsetWidth;

        // Remove the scrolling div from the doc
        outer.remove();

        // Pixel width of the scroller
        return width1 - width2;
    },

    /* Public: Updates each of the markers surrounding the hub, this should
     * be called each time the tank is panned or window scrolled.
     *
     * Examples
     *
     *   $(window).scroll(tank.updateMarkers);
     *
     * Returns nothing.
     */
    updateMarkers: function () {
        _.each(this.hubViews, function (view) {
            var isVisible = this._isHubViewVisible(view),
                hub = view.model, position, scale;

            this.markersView.toggleMarker(hub, !isVisible);
            if (!isVisible) {
                position = this._hubViewPosition(view);
                scale = this._hubViewDistanceFromViewportCenter(position);
                scale = 1 - (0.7 * scale); /* Don't let scale go below 0.3 */
                this.markersView.updateMarker(hub, position.angles.y, scale);
            }
        }, this);
    },

    /* Determines if a HubView is currently visible in the viewport. This
     * does not include the sidebar.
     *
     * hubView - A HubView object.
     *
     * Returns true if the hub is visible.
     */
    _isHubViewVisible: function (hubView) {
        var hubBounds = hubView.getBounds(),
            visibleArea = this.markersView.getBounds();

        hubBounds.right  = hubBounds.left + hubBounds.width;
        hubBounds.bottom = hubBounds.top  + hubBounds.height;

        visibleArea.right  = visibleArea.left + visibleArea.width;
        visibleArea.bottom = visibleArea.top + visibleArea.height;

        return (
            hubBounds.left   < visibleArea.right  &&
            hubBounds.right  > visibleArea.left   &&
            hubBounds.top    < visibleArea.bottom &&
            hubBounds.bottom > visibleArea.top
        );
    },

    /* Returns the angle of the hub view relative to the center of the
     * viewport (in radians where 0 sits on the positive x-axis and rotation
     * is counter clockwise).
     *
     * hubView - A HubView object.
     *
     * Returns an angle in degrees.
     */
    _hubViewPosition: function (hubView) {
        var hubPosition = hubView.getCenter(),
            viewportCenter = this.getViewportCenter(),
            x = hubPosition.left   - viewportCenter.left,
            y = viewportCenter.top - hubPosition.top,
            PI = Math.PI, angle;

        // Calculate angle for first quadrant.
        angle = Math.atan(Math.abs(y) / Math.abs(x));

        if (x < 0 && y >= 0) {        // Second quadrant.
            angle = PI - angle;
        } else if (x < 0 && y < 0) {  // Third quadrant.
            angle = PI + angle;
        } else if (x >= 0 && y < 0) { // Fourth quadrant.
            angle = 2 * PI - angle;
        }

        return {
            sides:  {y: y, x: x},
            angles: {y: angle, x: 0.5 * PI - angle}
        };
    },

    _hubViewDistanceFromViewportCenter: function (position) {
        var viewportCenter = this.getViewportCenter(),
            positionX = position.sides.x,
            positionY = position.sides.y,
            maxDistance, currentDistance;

        currentDistance = (positionX * positionX) + (positionY * positionY);
        maxDistance = (this.tankWidth * this.tankWidth) + 
                      (this.tankHeight * this.tankHeight);

        return (currentDistance / maxDistance);
    },

    clearSVG: function(){
        return this.emptyElement(this.svg);
    },

    createSVGElement: function(nodeName){
        return document.createElementNS("http://www.w3.org/2000/svg", nodeName);
    },

    // NOTE: Creating the <svg> element this way allows it to render on iPad et al, whereas including the <svg> element directly in the HTML document does not. Inspired by http://keith-wood.name/svg.html
    createSVGRoot: function(container){
        var svg = this.createSVGElement("svg");
        svg.setAttribute("version", "1.1");

        container.appendChild(svg);
        return svg;
    },

    updateSVGDimensions: function(){
        this.svg.setAttribute("width", this.tankWidth);
        this.svg.setAttribute("height", this.tankHeight);
        return this;
    },

    addSVGLine: function(x1, x2, y1, y2){
        var line = this.svg && this.createSVGElement("line");

        if (line){
            line.setAttribute("x1", x1);
            line.setAttribute("x2", x2);
            line.setAttribute("y1", y1);
            line.setAttribute("y2", y2);
            this.svg.appendChild(line);
        }
        return this;
    },

    emptyElement: function(elem){
        if (elem){
            while (elem.firstChild) {
                elem.removeChild(elem.firstChild);
            }
        }
        return this;
    }
});
