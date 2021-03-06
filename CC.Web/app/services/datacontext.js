(function()
{
    'use strict';

    var serviceId = 'datacontext';
    angular.module('app').factory(serviceId,
        ['$rootScope', 'common', 'config', 'entityManagerFactory', 'model', 'repositories', 'zStorage', 'zStorageWip', datacontext]);

    function datacontext($rootScope, common, config, emFactory, model, repositories, zStorage, zStorageWip)
    {
        var entityNames = model.entityNames;
        var events = config.events;
        var getLogFn = common.logger.getLogFn;
        var log = getLogFn(serviceId);
        var logError = getLogFn(serviceId, 'error');
        var logSuccess = getLogFn(serviceId, 'success');
        var manager = emFactory.newManager();
        var primePromise;
        var repoNames = ['attendee', 'lookup', 'session', 'speaker'];
        var $q = common.$q;

        var service = {
            prime: prime,
            cancel: cancel,
            save: save,
            markDeleted: markDeleted,
            zStorage: zStorage,
            zStorageWip : zStorageWip
            // Repositories to be added on demand:
            //      attendees
            //      lookups
            //      sessions
            //      speakers
        };

        init();

        return service;

        function init()
        {
            zStorage.init(manager);
            zStorageWip.init(manager);
            repositories.init(manager);
            defineLazyLoadedRepos();
            setupEventForHasChangesChanged();
            setupEventForEntitiesChanged();
            listenForStorageEvents();
        }

        // Add ES5 property to datacontext for each named repo
        function defineLazyLoadedRepos()
        {
            repoNames.forEach(function(name)
            {
                Object.defineProperty(service, name, {
                    configurable: true, // will redefine this property once
                    get: function()
                    {
                        // The 1st time the repo is request via this property, 
                        // we ask the repositories for it (which will inject it).
                        var repo = repositories.getRepo(name);

                        // Rewrite this property to always return this repo;
                        // no longer redefinable
                        Object.defineProperty(service, name, {
                            value: repo,
                            configurable: false,
                            enumerable: true
                        });

                        return repo;
                    }
                });
            });
        }

        function prime()
        {
            if (primePromise)
            {
                return primePromise;
            }

            // Look in local storage and if data is there, grab it;
            // otherwise get from 'resources'
            var storageEnabledAndHasData = zStorage.load(manager);

            primePromise = storageEnabledAndHasData ?
                $q.when(log('Loading entities and metadata from Local Storage')) :
                $q.all([service.lookup.getAll(), service.speaker.getPartials(true)])
                    .then(extendMetadata);

            return primePromise.then(success);

            function success()
            {
                service.lookup.setLookups();

                zStorage.save();

                log('Primed the data');
            }

            function extendMetadata()
            {
                var metadataStore = manager.metadataStore;

                model.extendMetadata(metadataStore);

                registerResourceNames(metadataStore);
            }

            function registerResourceNames(metadataStore)
            {

            var types = metadataStore.getEntityTypes();
                types.forEach(function(type)
                {
                    if(type instanceof breeze.EntityType)
                    {
                        set(type.shortName, type);
                    }
                });

                var personEntityName = entityNames.person;

                ['Speakers', 'Speaker', 'Attendees', 'Attendee'].forEach(function(r)
                {
                    set(r, personEntityName);
                });

                function set(resourceName, entityName)
                {
                    metadataStore.setEntityTypeForResourceName(resourceName, entityName);
                }
            }
        }

        function cancel()
        {
            if (manager.hasChanges())
            {
                manager.rejectChanges();

                logSuccess('Canceled changes', null, true);
            }
        }

        function save()
        {
            return manager.saveChanges()
                .then(saveSucceeded, saveFailed);

            function saveSucceeded(result)
            {
                zStorage.save();

                logSuccess('Saved data', result, true);
            }

            function saveFailed(error)
            {
                var msg = config.appErrorPrefix + 'Save failed: ' +
                    breeze.saveErrorMessageService.getErrorMessage(error);

                error.message = msg;

                logError(msg, error);

                throw error;
            }
        }

        function setupEventForHasChangesChanged()
        {
            manager.hasChangesChanged.subscribe(function(eventArgs)
            {
                var data = { hasChanges: eventArgs.hasChanges };
                // Send the message (the Controller receives it)
                common.$broadcast(events.hasChangesChanged, data);
            });
        }

        function setupEventForEntitiesChanged()
        {
            // We use this for detecting changes of any kind so we can save them to local storage
            manager.entityChanged.subscribe(function(changeArgs)
            {
                if(changeArgs.entityAction === breeze.EntityAction.PropertyChange)
                {
                    interceptPropertyChange(changeArgs);

                    common.$broadcast(events.entitiesChanged, changeArgs);
                }
            });
        }

        // Forget certain changes by removing them from the entity's originalValues
        // This function becomes unnecessary if Breeze decides that
        // unmapped properties are not recorded in originalValues
        //
        // We do this so we can remove the isSpeaker and isPartial properties from
        // the originalValues of an entity. Otherwise, when the object's changes
        // are canceled these values will also reset: isPartial will go
        // from false to true, and force the controller to refetch the
        // entity from the server.
        // Ultimately, we do not want to track changes to these properties, 
        // so we remove them.        
        function interceptPropertyChange(changeArgs)
        {
            var changedProp = changeArgs.args.propertyName;

            if(changedProp === 'isPartial' || changedProp === 'isSpeaker')
            {
                delete changeArgs.entity.entityAspect.originalValues[changedProp];
            }
        }

        function markDeleted(entity)
        {
            return entity.entityAspect.setDeleted();
        }

        function listenForStorageEvents()
        {
            $rootScope.$on(config.events.storage.storeChanged, function(event, data)
            {
                log('Updated local storage', data, true);
            });

            $rootScope.$on(config.events.storage.wipChanged, function(event, data)
            {
                log('Updated WIP', data, true);
            });

            $rootScope.$on(config.events.storage.error, function(event, data)
            {
                logError('Error with local storage. ' + data.activity, data, true);
            });
        }
    }
})();