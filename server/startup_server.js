var zmq = require('zmq');
var express = require('express');
var app = express();
var mongo = require('mongodb');
var MongoClient = mongo.MongoClient;
var io = require('socket.io').listen(10000);
var bodyParser  = require('body-parser');
var session = require('express-session');
var startupCollection;
var userCollection;
var dbHandler;

app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.use(session({secret:"abc"}));
app.use(express.static(__dirname + '/views'));
var pub = zmq.socket('pub');

function init_server() {
    // Binding publisher socket
    pub.bind("tcp://127.0.0.1:11000", function(err){
        if (err) {
            console.log("Unable to bind publisher socket : " + err);
        }
        else {
            console.log("Publisher socket created");
        }
    });
    // Make connection with mongoClient. This connection would be shared b/w all the API's
    MongoClient.connect("mongodb://root:root@ds117859.mlab.com:17859/snapcare_test", function(err, db) {
        if (err) {
            console.log("Unable to connecto to MongoDb : " + err);
        }
        else {
            dbHandler = db;
            startupCollection = db.collection("startup");
            userCollection = db.collection("users");
        }
    });
}

app.get('/', function(req, res){
    var err = "";
    if (req.query.err != undefined){
        err = req.query.err;
    }
    res.render(__dirname + '/views/index_1.html', {"error" : err});
});

app.post('/', function(req, res){
    var uid = req.body.uid;
    var pass = req.body.pass;
    userCollection.find({username:uid,pass:pass}).toArray(function(err, item){
        if(err || !item.length) {
            res.redirect('/?err=Please check your username and password.');
        }
        else{
            req.session.uid = uid;
            res.render(__dirname + '/views/home.html', {"uid" : req.session.uid});
        }
    });
});

app.get('/logout', function(req, res){
    req.session.destroy(function(err){
        if (err) {
            console.log(err);
        }
        else{
            res.redirect("/");
        }
    });
});

app.get('/search', function(req, res){
    if(req.session.uid) {
        var low = parseInt(req.query.lowFunding);
        var high = parseInt(req.query.highFunding);
        startupCollection.find({raisedAmt:{$gte:low,$lte:high}}).toArray(function(err, items){
            if(err || !items.length) {
                res.send("<p>No items found</p>");
            }
            else {
                var response = "<table border='1'><tr><th>Company</th><th>Category</th><th>City</th><th>State</th><th>Funding Date</th><th>Raised Amount</th><th>Raised Currency</th><th>Round</th>";

                for(var i in items){
                    var item = items[i];
                    response += "<tr><td>" + item.company + "</td><td>" + item.category + "</td><td>" + item.city + "</td><td>" + 
                                item.state + "</td><td>" + item.fundedDate + "</td><td>" + item.raisedAmt + "</td><td>" + 
                                item.raisedCurrency + "</td><td>" + item.round + "</td></tr>";
                }
                response += "</table>"
                res.send(response);
            }
        });
    }
    else {
        res.redirect('/?err=Please login first');
    }
});

app.get('/chat', function(req, res){
    if (req.session.uid){
        userCollection.find().toArray(function(err, response){
            if (err){
                res.sendFile(__dirname + '/views/home.html');
            }
            else {
                var userList = [];
                for (var i in response){
                    if ((response[i]).username != req.session.uid){
                        userList.push((response[i]).username);
                    }
                }
                res.render(__dirname + '/views/chat.html', {"users" : userList, "uid" : req.session.uid});
            }
        });
    }
    else {
        res.redirect('/?err=Please login first');
    }
});

// Proxy for communication b/w ZMQ pub/sub sockets and web client's socket.io socket
io.sockets.on('connection', function(socket){
    // For each socket.io connection create a subscriber socket.
    // Subscribe topics for topic of interest(messages for user itself. So topic is username) on this subscriber.
    // On receiving data on subscriber socket, send data to web client using socket.io
    var subscriberSocket = zmq.socket('sub');
    subscriberSocket.connect('tcp://127.0.0.1:11000');

    socket.on('subscribeChannel', function(username){
        subscriberSocket.subscribe(username);

        // On receiving any message on this subscriber send it to web client using socket.io
        subscriberSocket.on('message', function(msg){
            var index = msg.toString().indexOf(" ") + 1;
            var message = msg.toString().substring(index);
            socket.emit("message", message);
        });
    });
    
    // On receiving any message from web client, publish it using publisher. Message format is <receiver> <sender> <message>
    // Here Receiver is the channel on which the data would be published and only those subscriber would be able to read this data
    // who have subscriber to this topic.
    socket.on('message', function(message){
        pub.send(message);
    });
    
    socket.on('close', function ()
    {
        subscriberSocket.close();
    });

    socket.on('end', function ()
    {
        subscriberSocket.close();
    });

    socket.on('disconnect', function ()
    {
        subscriberSocket.close();
    });
});

// On starting the http server do initial processing
var server = app.listen(8000, function(){
    init_server();
    console.log("Node.js server started");
});

// On closing server close database handler
server.on("close", function(){
    dbHandler.close();
});
