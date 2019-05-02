const diffy = require('diffy')({fullscreen: false});
const input = require('diffy/input')({showCursor: true});
const stripAnsi = require('strip-ansi');

// diffy - a framework for building interactive command line tools
// https://github.com/mafintosh/diffy


function ViewController (chatService) {
  draw(chatService);
  input.on('update', () => { draw(chatService); });
  input.on('enter', line => {
    chatService.addMessageToDoc(line);
    draw(chatService);
  });

  chatService.on('updated', chatService => draw(chatService));

  // For network connection display
  setInterval(() => { draw(chatService); }, 1000);
}

function draw (chatService) {
  let username = chatService.username;
  let broadcastID = chatService.broadcastID;
  let doc = chatService.doc;

  diffy.render(() => {
    let screenWriter = '';
    screenWriter += `Group ID :: ${broadcastID}\n`;
    screenWriter += `Use the above groupID to join the diffy`;
    screenWriter += `Active connections :: ${chatService.getConnections()}`;
    screenWriter += `Use Ctrl-C to exit.\n\n`;

    let displayMessages = [];
    let {messages} = doc;
    Object.keys(messages).sort().forEach(key => {
      if (key === '_objectId') return;
      if (key === '_conflicts') return;
      
      let {username, message, joined} = messages[key];
      if (joined) {
        displayMessages.push(`[${username.toUpperCase()}] has joined the broadcast group`);
      } else {
        if (message) {
          displayMessages.push(`[${username.toUpperCase()}] >> ${message}`);
        }
      }
    });

    const maxMessages = 10;
    displayMessages.splice(0, displayMessages.length - maxMessages);
    displayMessages.forEach(line => {
      screenWriter += stripAnsi(line).substr(0, diffy.width - 2) + '\n';
    });
    for (let i = displayMessages.length; i < 10; i++) {
      screenWriter += '\n';
    }
    screenWriter += `\n[${username.toUpperCase()}]  ${input.line()}`;
    return screenWriter;
  });
}

module.exports = ViewController;
