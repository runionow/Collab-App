const Collab = require('./index');
const {EventEmitter} = require('events');
const ram = require('random-access-memory');
/**
 * This app works great limited number of users not capable of managing large 
 * number of users
 * 
 * As some of the data structures which i used for building the collab service are 
 * not completely tested cannot estimate the performance capability of the application
 */
EventEmitter.prototype._maxListeners = 10;

class ChatService extends EventEmitter {
  constructor ({broadcastID, username}) {
    super();

    this.broadcastID = broadcastID;
    this.username = username;
    this.collab = new Collab({path: ram});

    // Initialize on 'ready' event from collab service
    this.collab.once('ready', this.init.bind(this));
  }

  // Check for the broadcast ID if the broadcast ID is provided
  // use to join the existin service 
  // if not create a new broadcastID
  init (collabService) {
    collabService.joinBroadcastGroup(); 

    if (!this.broadcastID) {
      collabService.create();
      collabService.once('document:ready', (docId, doc) => {
        this.broadcastID = docId;
        this.doc = collabService.change(doc, changeDoc => {
          changeDoc.messages = {};
        });
        this.ready(this.doc);
      });
    } else {
      console.log('Joining broadcast channel >> >> >> >> >> >>');
      collabService.open(this.broadcastID);
      collabService.once('document:ready', 
            (docId, doc) => { this.ready(doc); });
    }
  }
  
  addMessageToDoc (line) {
    let message = line.trim();
    if (message.length === 0) return this.doc;
    this.doc = this.collab.change(this.doc, changeDoc => {
      changeDoc.messages[Date.now()] = {
        username: this.username,
        message: line
      };
    });
    return this.doc;
  }

  getConnections () {
    return this.collab.swarm.connections.length;
  }

  ready (doc) {
    this.doc = doc;
    this.joinChannel();
    this.emit('ready', this);

    this.collab.on('document:updated', (docId, doc) => {
      this.doc = doc;
      this.emit('updated', this);
    });
  }

  
  joinChannel () {
    this.doc = this.collab.change(this.doc, changeDoc => {
      changeDoc.messages[Date.now()] = {
        username: this.username,
        joined: true
      };
    });
  }

}

module.exports = ChatService;