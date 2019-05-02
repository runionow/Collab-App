const Config = require("./config");
const _keepPromise = require("./keepPromise");
const EventEmitter = require('events');
const discoverySwarm = require('discovery-swarm');
const swarmDefaults = require('datland-swarm-defaults');
const am = require('automerge');
const CollabBackend = require('./CollabBackend');


// [PLEASE READ - BEFORE YOU GO DEEP DOWN] 
// ==========================================================================================
// Collab framework allows user to build peer 2 peer applications using CRDT and hypercore (append only log)
// It has to be understood that all the features of automerge (CRDT) and hypercore (append only log) library are not available in this framework 
// This framework has limited features and does not provide all the features mentioned on the 
// automerge and hypercore library
// persistence features for this libray is taken from an open sourced project 
// please refer to collabBackend.js for further details

// NOTE: Some of the functions in here are taken and modified from the ink&switch research - SanFrancisco, as they have already working on building some of the
// cool applications using both of these library- pixelpusher and Trellis
// Please do not use the function starting with "_" as this happens to be some of the private functions of our framework

// Copyright for actual implementation of automerge and hypercore belongs to there contributors of the projects
// are available for public use and modifications github.com/automerge

// This project is an effort to bring the best of both CRDT and append only log to building an real world p2p application

// [THANK YOU]


class Collab extends EventEmitter {

  constructor ({path}) {
    super();
    
    // flags and broadcast group details
    this.initMetadata = {};     // Used for dynamic initilization of the metadata on create()
    this.initFlag = false;      // Flag to verify the state

    // Enabling the persistance library
    this.backend = new CollabBackend(path);
    this.backend.ready(this._onBackendReady());

    // Initializing [DATA-STRUCTURES] for keeping track of the documents, actors and groups
    this.readyIndex = {};       // Tracking state of all the docs [key: docID, value: availability]
    this.groupIndex = {};       // Keeping track of all the automerge actors in the group [key: group, value: [actors]]
    this.docIndex = {};         // Keep track of the docid and actors [key: docID, value: [actors]]
    this.metaTracker = {};      // Used to save metadata of the actor [key: actorID , value: {metadata}]
    this.requestedBlocks = {};  // [key:docID value: {actorId: xxf}]
    this.logs = {};            // ledger
    this.pDocs = {};            // Automerge documents - previous state
    this.docs = {};             // Automerge documents - current state
  }

  // Verify all Collab metadata is properly instantiated on create
  isAppReady () {
    if (!this.initFlag) {
      throw new Error("Collab class is not properly instantiated, check for instructions for properly instantiating the application");
    }
  }

  // Verify the current instance has the docID you are looking for in the current state
  contains (docId) {
    return !!this.docs[docId];
  }

  // Get the document with docID from the current state
  get (docId) {
    let document = this.docs[docId];
    if (!document) {
      throw new Error(`Document not found with docId: ${docId}`);
    }
    return document;
  }

  // Update current Document state with the new state
  // [WARNING] - illegal use of the patch may cause the current state of the application
  // corrupted
  patch (doc) {
    let docId = this.getId(doc);
    this.docs[docId] = doc;
    return doc;
  }

  // Open Document allows to retrieve a document, if not available 
  // a new document will be created
  open (docId) {
    this.isAppReady();
    if (this.docs[docId]) return this.docs[docId];
    this.feed(docId);
  }

  // Initialize the application with initial set of automerge documents and log
  // [NOTE] : The first block of the append only log is used to store the state of the 
  // append only log
  create (metadata = {}) {
    this.isAppReady();
    return this._init(metadata);
  }

  // Refactor-helper function 
  _init (metadata, parentMetadata = {}) {
    let feed = this.feed(); let actorId = feed.key.toString('hex');
    metadata = Object.assign(
      {},
      Config.ENV,
      { groupId: actorId }, 
      parentMetadata, 
      this.initMetadata, 
      { docId: actorId }, 
      metadata 
    );
    this.attachMetadata(actorId, metadata);
    let doc = this.patch(this.cleanState(actorId));
    let {groupId} = this.metadata(this.getActorId(doc));
    let keys = this.groupIndex[groupId];
    this.message(groupId, {type: 'FEEDS_SHARED', keys});
    return doc;
  }

  // Update current state of the application with the new state
  // [WARNING] : this functions updates the current state of the automerge documents
  update (doc) {
    this.isAppReady();

    // Retrieve previous document state
    let aId = this.getActorId(doc);  // actorID
    let dId = this.actorToId(aId);   // docID
    let pDoc = this.get(dId);       

    const changes = am.getChanges(pDoc, doc)
      .filter(({actor}) => actor === aId);
    this._addToMaxRequested(dId, aId, changes.length);
    this.appendDataBlock(aId, changes);
    this.pDocs[dId] = doc;
    return this.patch(doc);
  }

  // Merge remote document state with the current state
  // helps to perform remote updates
  merge (destId, sourceId) {
    this.isAppReady();
    
    let date = new Date();
    let destination = this.get(destId);
    let source = this.get(sourceId);

    return this.change(
      am.merge(destination, source),
      `New merge request ${destId+ " " + date}`,
      () => {});
  }

  // Remove a doc from both backend and the current state
  cleanup (docId) {
    this._deleteDocBackend(docId); // 1. Remove the doc from the backend
    this._deleteDoc(docId); // 2. Remove the doc from current current state
  }

  // Remove from backend
  _deleteDocBackend(docId) {
    this.backend.archiver.remove(docId);
  }

  // Remove from the current object
  _deleteDoc(docId) {
    delete this.logs[docId];
    delete this.docs[docId];
    delete this.pDocs[docId];
  }

  // Send message to all the peers in the swarm
  // Here the message is an updated doc or can be a custom message
  message (actorId, msg) {
    this.feed(actorId).peers.forEach(
      peer => {
        this._messagePeer(peer, msg);
      }
    );
  }

  // Size of the current log
  length (actorId) {
    let len = this._log(actorId).length;
    return len;
  }

  // Persistence: check whether current log is writable or not
  hasLock (actorId) {
    return this._log(actorId).writable;
  }

  // Persistence: check whether doc is opened by the actor for updations
  isOpened (actorId) {
    return this._log(actorId).opened;
  }

  // Check for missing deps
  isMissingDeps (docId) {
    let missingDeps = am.getMissingDeps(this.get(docId));
    return !!Object.keys(missingDeps).length;
  }

  // Clean the state for the given actor
  cleanState (actor) {
    return Config.ENV.immutableApi ? am.initImmutable(actor) : am.init(actor);
  }

  // Get metadata of an actor
  metadata (actorId) {
    return this.metaTracker[actorId];
  }

  // Check whether docId of an actor is an actorID
  isDocId (actorId) {
    return this.actorToId(actorId) === actorId;
  }

  getId (doc) {
    return this.actorToId(doc._actorId);
  }

  actorToId (actorId) {
    const {docId} = this.metadata(actorId);
    return docId;
  }

  // Get actorid of the automerge document - wrapper function for the 
  // automerge 
  getActorId (doc) {
    return doc._actorId; // default _actorId for an automerge document, refer automerge documentation
  }

  _log (actorId = null) {
    const key = actorId ? Buffer.from(actorId, 'hex') : null;
    return this.backend.createFeed(key);
  }

  feed (actorId = null) {
    this.isAppReady();
    if (actorId && this.logs[actorId]) {
      return this.logs[actorId];
    }
    return this._LogTracker(this._log(actorId));
  }

  isDocReady (docId) {
    return this.readyIndex[docId];
  }

  replicate (opts) {
    return this.backend.replicate(opts);
  }

  // [Naive implementation :: Needs Improvement]
  // This code has been taken from the sample example for adding hosts to the broadcast groups
  // github::discovery-swarm
  joinBroadcastGroup (opts = {}) {
    this.isAppReady();
    let {archiver} = this.backend;
    const bg = this.swarm = discoverySwarm(swarmDefaults(Object.assign({
      port: Config.ENV.port,
      hash: false,
      encrypt: true,
      stream: opts => this.replicate(opts)
    }, opts)));
    bg.join(archiver.changes.discoveryKey);

    Object.values(this.logs).forEach(feed => {
      bg.join(feed.discoveryKey);
    });

    archiver.on('add', feed => {
      bg.join(feed.discoveryKey);
    });

    archiver.on('remove', feed => {
      bg.leave(feed.discoveryKey);
    });

    bg.listen(Config.ENV.port);

    bg.once('error', err => {
      console.error('Unable to connect to the broadcast', err);
      bg.listen();
    });

    return this;
  }

  // Make sure this command has been called only for once
  // attach metadata
  attachMetadata (actorId, metadata) {
    if (this.length(actorId) > 0) {
      throw new Error("Metadata can be updated only once, please verify the documentation for more info");
    }
    this._setMetadata(actorId, metadata);
    return this.appendData(actorId, metadata);
  }

  // Append single message to the block
  // This funciton has to be called after attachMetadata(actor,Metadata);
  // The first block always has to be a metadata
  appendData (actorId, change) {
    return this.appendDataBlock(actorId, [change]);
  }

  // Append message block to the hypercore
  // This funciton has to be called after attachMetadata(actor,Metadata);
  // The first block always has to be a metadata
  appendDataBlock (actorId, changes) {
    let blocks = changes.map(change => JSON.stringify(change));
    return _keepPromise(cb => {
      this.feed(actorId).append(blocks, cb);
    });
  }

  _LogTracker (log) {
    let actorId = log.key.toString('hex');
    this.logs[actorId] = log;
    log.ready(this._onLogReady(actorId, log));
    log.on('peer-add', this._onPeerAdded(actorId));
    log.on('peer-remove', this._onPeerRemoved(actorId));
    return log;
  }

  // Emit ready status when current log is ready 
  _onLogReady (actorId, log) {
    return () => {
      this._loadMetadata(actorId)
      .then(() => {
        let docId = this.actorToId(actorId);
        this._createNewDoc(docId, actorId);
        log.on('download', this._onDownload(docId, actorId));
        return this._loadAllDataBlocks(actorId)
          .then(() => {
            if (actorId !== docId) return;
            this.readyIndex[docId] = true;
            this._emitReady(docId);
          });
      });
      this.emit('feed:ready', log);
    };
  }

  // Creates a new doc if doc being searched is not found
  _createNewDoc (docId, actorId) {
    if (this.docs[docId]) return;
    if (this.hasLock(actorId)) {
      this.docs[docId] = this.cleanState(actorId);
    }
    let pMetadata = this.metadata(actorId);
    return this._init({docId}, pMetadata);
  }

  _initLogs (actorIds) {
    return Promise.all(
      actorIds.map(actorId => {
        if (this.length(actorId) === 0) {
          // Bad code: needs fix
          return Promise.resolve(null);
        }

        return this._loadMetadata(actorId)
        .then(({docId}) => {
          if (this.hasLock(actorId)) {
            this.docs[docId] = this.cleanState(actorId);
          }
        })
        .then(() => actorId);
      }));
  }

  _loadMetadata (actorId) {
    if (this.metaTracker[actorId]) {
      return Promise.resolve(this.metaTracker[actorId]);
    }

    return _keepPromise(cb => {
      this._log(actorId).get(0, cb);
    }).then(data => this._setMetadata(actorId, JSON.parse(data)));
  }

  _setMetadata (actorId, metadata) {
    if (this.metaTracker[actorId]) {
      return this.metaTracker[actorId];
    }

    this.metaTracker[actorId] = metadata;
    const {docId, groupId} = metadata;

    if (!this.groupIndex[groupId]) {
      this.groupIndex[groupId] = [];
    }
    this.groupIndex[groupId].push(actorId);

    if (!this.docIndex[docId]){
      this.docIndex[docId] = [];
    }
    this.docIndex[docId].push(actorId);

    return metadata;
  }

  _loadAllDataBlocks (actorId) {
    return this._loadOwnDataBlocks(actorId)
    .then(() => this._loadMissingDataBlocks(actorId));
  }

  _loadOwnDataBlocks (actorId) {
    const docId = this.actorToId(actorId);
    return this._loadDataBlocks(docId, actorId, this.length(actorId));
  }

  _loadMissingDataBlocks (actorId) {
    let docId = this.actorToId(actorId);

    if (docId !== actorId) return;

    let deps = am.getMissingDeps(this.get(docId));

    return Promise.all(Object.keys(deps).map(
      actor => {
        const last = deps[actor] + 1;
        return this._loadDataBlocks(docId, actor, last);
      }
    ));
  }

  _loadDataBlocks (docId, actorId, last) {
    let first = this._maxRequested(docId, actorId, last);

    if (first >= last) return Promise.resolve();

    return this._getDataBlockRange(actorId, first, last)
      .then(blocks => this._applyBlocks(docId, blocks))
      .then(() => this._loadMissingDataBlocks(docId));
  }

  _getDataBlockRange (actorId, first, last) {
    const length = Math.max(0, last - first);

    return Promise.all(Array(length).fill().map((_, i) =>
      this._getDataBlock(actorId, first + i)));
  }

  _getDataBlock (actorId, index) {
    return _keepPromise(cb => {
      this.feed(actorId).get(index, cb);
    });
  }

  _applyBlock (docId, block) {
    return this._applyBlocks(docId, [block]);
  }

  _applyBlocks (docId, blocks) {
    return this._applyChanges(docId, blocks.map(block => JSON.parse(block)));
  }

  _applyChanges (docId, changes) {
    return changes.length > 0 ? this._setRemote(am.applyChanges(this.get(docId), changes))
      : this.get(docId);
  }

  // Change tracker made on each block 
  _maxRequested (docId, actorId, max) {
    if (!this.requestedBlocks[docId]){
      this.requestedBlocks[docId] = {};
    } 

    const current = this.requestedBlocks[docId][actorId] || Config.DATA_START;
    this.requestedBlocks[docId][actorId] = Math.max(max, current);
    return current;
  }

  _addToMaxRequested (docId, actorId, x) {
    if (!this.requestedBlocks[docId]) this.requestedBlocks[docId] = {};
    this.requestedBlocks[docId][actorId] = (this.requestedBlocks[docId][actorId] || Config.DATA_START) + x;
  }

  // Emit update status on download
  _setRemote (doc) {
    let docId = this.getId(doc);
    this.patch(doc);
    if (this.readyIndex[docId] && !this.isMissingDeps(docId)) {
      const pDoc = this.pDocs[docId];
      this.pDocs[docId] = doc;
      this.emit('document:updated', docId, doc, pDoc);
    }
  }

  _relatedKeys (actorId) {
    const {groupId} = this.metadata(actorId);
    return this.groupIndex[groupId];
  }

  _messagePeer (peer, msg) {
    const data = Buffer.from(JSON.stringify(msg));
    peer.stream.extension('hypermerge', data);
  }

  _onBackendReady () {
    return () => {
      let actorIds = Object.values(this.backend.archiver.feeds)
        .map(feed => feed.key.toString('hex'));

      this._initLogs(actorIds)
      .then(() => {
        this.initFlag = true;
        actorIds.forEach(actorId => this.feed(actorId));
        this.emit('ready', this);
      });
    };
  }

  _onDownload (docId, actorId) {
    return (index, data) => {
      this._applyBlock(docId, data);
      this._loadMissingDataBlocks(docId);
    };
  }

  _onPeerAdded (actorId) {
    return peer => {
      peer.stream.on('extension', this._onExtension(actorId, peer));

      this._loadMetadata(actorId)
      .then(() => {
        if (!this.isDocId(actorId)) return;

        const keys = this._relatedKeys(actorId);
        this._messagePeer(peer, {type: 'FEEDS_SHARED', keys});

        this.emit('peer:joined', actorId, peer);
      });
    };
  }

  _onPeerRemoved (actorId) {
    return peer => {
      this._loadMetadata(actorId)
      .then(() => {
        if (!this.isDocId(actorId)) return;

        this.emit('peer:left', actorId, peer);
      });
    };
  }

  _onExtension (actorId, peer) {
    return (name, data) => {
      switch (name) {
        case 'hypermerge':
          return this._onDataRecieve(actorId, peer, data);
        default:
          this.emit('peer:extension', actorId, name, data, peer);
      }
    };
  }

  _onDataRecieve (actorId, peer, data) {
    let msg = JSON.parse(data);

    switch (msg.type) {
      case 'FEEDS_SHARED':
        return msg.keys.map(actorId => this.feed(actorId));
      default:
        this.emit('peer:message', actorId, peer, msg);
    }
  }

  // Emit document ready status
  _emitReady (docId) {
    const doc = this.get(docId);
    this.pDocs[docId] = doc;
    this.emit('document:ready', docId, doc);
  }

  // Wrapper for the automerge function 
  change (doc, msg = null, changeFx) {
    return this.update(am.change(doc, msg, changeFx));
  }
  
}

module.exports = Collab;
