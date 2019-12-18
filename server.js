var mosca = require('mosca');
var http = require("http");
var url = require('url');
const fs = require('fs');
const path = require('path');

//create a server object:
http.createServer(function (req, res) {
  var q = url.parse(req.url, true);
  if (q.path == "/status")
  {
    res.end(JSON.stringify(devices));
    return;
  } else if (q.pathname == "/action")
  {
    try {
        var client = undefined;
        if (q.query.devid != null)
        {
            client = dev_mapping[q.query.devid] || MqttServer.clients[q.query.devid];
            var newPacket = {
                topic: q.query.topic,
                payload: q.query.payload,
                messageId: MqttServer.generateUniqueId(),
                qos: 0,
                retain: undefined
            };
            if (client === undefined)
            {
                dev_msg_queue.push({
                    timeout: new Date().getTime() + 30000,
                    devid: q.query.devid,
                    packet: newPacket
                });
                res.end("Error: cannot found any client match devid");
                return false;
            }
            client.connection.publish(newPacket);
            res.write("Success");
            res.end();
            return;
        }
        MqttServer.publish({
            topic: q.query.topic,
            payload: q.query.payload,
            qos: 1
        });
    } catch(e)
    {
        res.end("Error: Failed to decode command: ",e);
        return false;
    }
    res.write("Success Broadcast");
    res.end();
    return;
  }
  let pathname = `html${q.pathname}`;
  // based on the URL path, extract the file extention. e.g. .js, .doc, ...
  const ext = path.parse(pathname).ext;
  // maps file extention to MIME typere
  const map = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword'
  };

  fs.exists(pathname, function (exist) {
    if(!exist) {
      // if the file is not found, return 404
      res.statusCode = 404;
      res.end(`File ${pathname} not found!`);
      return;
    }

    // if is a directory search for index file matching the extention
    if (fs.statSync(pathname).isDirectory()) pathname += '/index' + ext;

    // read file from file system
    fs.readFile(pathname, function(err, data){
      if(err){
        res.statusCode = 500;
        res.end(`Error getting the file: ${err}.`);
      } else {
        // if the file is found, set Content-type and send data
        res.setHeader('Content-type', map[ext] || 'text/plain' );
        res.end(data);
      }
    });
  });

  // console.log(q);
    
  // res.write('Hello World!'); //write a response to the client
  // res.end(); //end the response
}).listen(8080); //the server object listens on port 8080

//构建自带服务器
var MqttServer = new mosca.Server({
    port: 11883
});

var devices = {};
var dev_mapping = {};
var dev_msg_queue = [];

setInterval(function(){
    while (dev_msg_queue.length > 0 && dev_msg_queue[0].timeout <= new Date().getTime())
    {
        dev_msg_queue.shift();
    }
}, 1000);

//对服务器端口进行配置， 在此端口进行监听
MqttServer.on('clientConnected', function(client) {
    //监听连接
    if (client.id.substr(0, 3) != "HP-")
    {
        client.close();
        console.error('kill client by unknow id', client.connection.stream.remoteAddress.replace(/^::ffff:/, ""), client.id);
        return;
    }
    dev_mapping[client.id.substr(client.id.length - 12)] = client;
    devices[client.id.substr(client.id.length-12)] = { "devid": client.id.substr(client.id.length - 12), "cls": client.id.substr(0, client.id.length - 13), "timestamp": Math.floor(new Date().getTime() / 1000), "ip": client.connection.stream.remoteAddress.replace(/^::ffff:/, ""), "status": { "connected": true } };
    console.log(JSON.stringify({ "devid": client.id.substr(client.id.length - 12), "cls": client.id.substr(0, client.id.length - 13), "timestamp": Math.floor(new Date().getTime() / 1000), "ip": client.connection.stream.remoteAddress.replace(/^::ffff:/, ""), "status": { "connected": true } }));
    for (var i = 0; i<dev_msg_queue.length;i++)
    {
        if (client.id.substr(client.id.length - 12) == dev_msg_queue[i].devid)
        {
            console.error("Send Queued Msg To " + dev_msg_queue[i].devid)
            client.connection.publish(dev_msg_queue[i].packet);
            dev_msg_queue.splice(i, 1);
        }
    }
    // console.error('client connected', client.connection.stream.remoteAddress.replace(/^::ffff:/, ""), client.id);
});

//对服务器端口进行配置， 在此端口进行监听
MqttServer.on('clientDisconnected', function(client) {
    if (client.id.substr(0, 3) != "HP-")
    {
        return;
    }
    var st = { "devid": client.id.substr(client.id.length - 12), "timestamp": Math.floor(new Date().getTime() / 1000), "status": { "connected": false } };
    console.log(JSON.stringify(st));
    delete dev_mapping[client.id.substr(client.id.length - 12)];
});

MqttServer.on('subscribed', function(topic, client) {
    //监听连接
    // console.error('client subscribed', topic, client.id);
});

/**
 * 监听MQTT主题消息
 **/
MqttServer.on('published', function(packet, client) {
    //当客户端有连接发布主题消息
    if( packet.topic.indexOf( '$SYS' ) == 0 ) {
        // console.error("System event: ",packet.topic, packet.payload);
        return;
    }
    if (client === undefined) return;
    var topic = packet.topic;

    var devid = client.id.substr(client.id.length - 12);
    if (typeof(devices[devid]) == "undefined")
    {
        devices[devid] = { "devid": devid, "timestamp": Math.floor(new Date().getTime() / 1000), "status": {} };
    }
    if (m=topic.match(/^status\/(.+)$/))
    {
        devices[devid]["status"][m[1]] = packet.payload.toString();
        console.log(devices[devid]);
    } else if (topic == "status")
    {
        try{
            var pl = JSON.parse(packet.payload.toString());
            for (var k in pl)
            {
                devices[devid]["status"][k] = pl[k];
            }
            console.log(devices[devid]);   
        } catch(e)
        {
            console.error("Client packet invalid: ", topic, packet.payload.toString());
        }
    } else if (topic == "dev")
    {
        try{ 
            var st = JSON.parse(packet.payload.toString());
            st["timestamp"] = Math.floor(new Date().getTime() / 1000);
            for (var k in st)
            {
                devices[devid][k] = st[k];
            }
            if (typeof(st["status"]) == "undefined") st["status"] = {};
            console.log(devices[devid][k]);
        } catch(e)
        {
            console.error("Client packet invalid: ", topic, packet.payload.toString(), e);
        }
    }
});

MqttServer.on('ready', function() {
    //当服务开启时
    console.error('mqtt is running...');
});
