# Building Distributed P2P application with JSONCRDT and Distributed append only Log

## Prerequisite

1. Node v8.11.2
2. npm (Node package manager)
3. Internet connection

## Running the sample application

### Installing dependencies

The below command allows to install all the dependencies of the application

``` npm install```

### Start the application

Use the below command to create the new messenger group
``` node chat.js ```

### Join the existing group messenger

Use the below command to the join the existing messenger group
``` node chat.js [BROADCAST ID] ```


## Collab API

### create()

`create() helps to instantiate the application, Allows to create metadata if no broadcastID is available and appends it to the beginning of the log`

### isAppReady()

`Verify the current status of the application`


### merge(sourceID,destinationID)

`Allows to merge current state of the application to the remote state of the application`

### contains(docID)

`Check whether the current state consits of the automerge document with docID`


### change (doc, message, changeFx => {})

`Updates the automerge document with the current changes, this is a wrapper to an automerge function, for more information please look at the automerge library about Automerge.change(doc, message, changeFx => {})`

### length(actorID)

`Gives length of the current log for agive actor`

### hasLock (actorId) 

`Check whether the given actor can modify the logs or not`

### cleanState()

`Clean the current state of the application`

### joinBroadcastGroup (options = {})

`Join the  broadcast group `

### replicate()

`Replicate the logs manually across all the peers.
helps to pass existing state to all the peers once available`

### message()

`Broadcast message to all the members in the swarm with same broadcastID`

### feed()

`Get the current log state of the application`

### appendData(actorID,(change) => {})

`Append data blocks to the current log`

### appendDataBlocks(changes) 

`Appends multiple datablocks to the log`

This project has been done as a part of Distributed Systems coursework (C) 2019 Arun Nekkalapudi anekkal@iu.edu, Indiana University Bloomington.







