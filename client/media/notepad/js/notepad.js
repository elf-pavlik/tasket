// notepad.js is the Notepad app's specific app.js
// TODO: more tank-related functionality out of app.js and into tank.js

_.extend(app, {
    selectedHub: null,
    currentUser: null,
    authtoken: null,
    csrftoken: null,
    bodyElem: jQuery(document.body),
    cache: cache,

    _setupOverrides: function () {
        // Always set task records as private so that
        // they can be accessed only by the their owner.
        Task.prototype.defaults.privacy = true;
        
        return this;
    },

    _setupLightbox: function(){
        var lightbox = app.lightbox = new Lightbox();

        this.bodyElem.append(lightbox.render().el);
        // Return to the previous route when the lightbox closes
        lightbox.bind("hide", function(){
            app.back(lightbox.historyCount);
        });
        return this;
    },

    _setupAuth: function(){
        // Need to restore the user from the cache once all the hubs are loaded.
        // This ensures that the users hubs are not requested before Tasket.hubs
        // is reset.
        this.restoreCache().setupAuthentication();

        // Destroy the cached user details when the logout button is clicked.
        // This block can be removed once Ticket #84 has been resolved and the
        // server deletes the "sessionid" cookie on logout:
        // https://github.com/dharmafly/tasket/issues/84
        jQuery("form[action='/logout/']").submit(function (event) {
            app.destroyCache();
        });

        return this;
    },
    
    getLatestOpenHub: function(user){
        var hubIds = user.getNonArchivedHubs();
        return hubIds.length ? _.max(hubIds) : null;
    },

    _bindHubEvents: function (user) {
        var hubId = this.getLatestOpenHub(user),
            hash = window.location.hash.slice(1),
            hub;

        // There is already a hub we can load
        if (hubId && (hash === "/" || hash === "/login/")){
            this.selectHub(hubId);
        }
        
        // No existing hubs. Create a new one
        else if (hash === "/") {
            this.createAndSelectHub(user);
        }
        
        return this;
    },

    selectHub: function(hubId){
        // TODO: Work out why the commented out code doesnt work
        
        // change hash to new id
        // var hub = Tasket.getHubs(hubId),
        //     mockView = {model:hub};
        // 
        // View.prototype.updateLocation.apply(mockView);
        // return this;
        
        var hub = app.selectedHub = Tasket.getHubs(hubId);
        
        // If the hub data is complete
        if (hub.isComplete()){
            app.trigger("change:selectedHub", hub);
        }
        // Otherwise wait for data to load from the server
        else {
            hub.bind("change", function onLoad(){
                hub.unbind("change", onLoad);
                app.trigger("change:selectedHub", hub);
            });
        }
        
        return this;
    },

    createAndSelectHub: function(user){
        var hub = app.selectedHub = new Hub({
                title: app.lang.NEW_HUB,
                owner: user.id
            });
        
        hub.bind("change:id", function (hub) {
            app.trigger("change:selectedHub", hub);
        });
        hub.save();
        
        return this;
    },

    /*
    * Creates a placeholder task list ("hub") on user login if the user has not
    * created one already.
    *
    */
    _setupHub: function () {
        this.bind("change:currentUser", function (user) {
            // user record is in localStorage
            if (user.id) {
                this._bindHubEvents(user);
            }
            else {
                // this will not be triggered when the user record is cached,
                // as the user id will be unchanged when the server responds
                user.bind("change:id", this._bindHubEvents);
            }
        });
        
        return this;
    },

    _setupHistory: function(){
        // If user lands on root update the url to "/#/" for consistency. This
        // can be removed should the history API be implemented.
        if (!window.location.hash) {
            window.location.hash = "/";
        }

        Backbone.history.start();
        return this;
    },

    bootstrap: function () {
        this.router = new Backbone.Router();
        this.controller = new TaskController({router: this.router});
        this.accountController = new AccountController({router: this.router});
        this.toolbar = new Toolbar({el: document.getElementById("mainnav")});
        
        this.setupStaticTemplates()
            ._setupOverrides()
            ._setupLightbox()
            ._setupAuth()
            // NOTE: _setupHub after _setupAuth, to prevent double-load of view
            ._setupHub()
            ._setupHistory()
            // NOTE: "change:currentUser" fires once on retrieval from localStorage, and once again on retrieval from the server, to refresh the localStorage cache
            .bind("change:currentUser", this._cacheChangesToCurrentUser);

        if (!app.currentUser){
            jQuery("section#content").html(tim("welcome-msg"));
            jQuery("body").removeClass("loggedin");


            // setup all the screenshots to go big on click
            jQuery(".features img").each(function(index, node) {
                
                jQuery(node).bind("click", function(){
                    var srcNode = jQuery(node).clone(),
                        bigImgPath = srcNode.attr("src"),
                        parts = bigImgPath.split(".");
                        
    			    if(parts.length){
    			        parts[parts.length-2] = parts[parts.length-2]  + "-big";
    			        bigImgPath = parts.join(".");
    			    }

                    app.lightbox.content(srcNode.attr({
                        "src": bigImgPath,
                        "width": 920,
                        "height": 500,
                    }), "wide").show();
                })
            });
        }

        // Load the server settings.
        // Override the value of Tasket.settings with the
        // values returned from the server
        this.init(app._cacheServerSettings());
    }
});
