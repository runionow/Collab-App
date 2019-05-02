const minimist = require('minimist');
const ChatService = require('./broadcastService');
const ViewController = require('./view');

const argv = minimist(process.argv.slice(2));
if (argv.help || argv._.length > 1) {
  console.log('Usage: node chat.js --name=<name> [BROADCAST-ID]\n');
  process.exit(0);
}

let username = argv.name;
if (!argv.name) {
  let prompt = require('prompt-sync')();
  username = prompt('Enter your nickname: ');
}

let broadcastID = argv._[0];
const service = new ChatService({broadcastID, username});
service.once('ready', (service) => {
  ViewController(service);
});
