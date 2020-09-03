var fs = require('fs');
var https = require('https');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var request = require('request');
var moment = require('moment');

var FitbitToTCX = require('./fitbitToTCX');

var app = express();
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(cookieParser());

var config = JSON.parse(fs.readFileSync('./config.json'));

app.get("/auth", function (req, res) {
    res.redirect("https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=22BCZ6&redirect_uri=https%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=activity%20heartrate%20location%20nutrition%20profile%20settings%20sleep%20social%20weight&expires_in=604800");
});

app.get("/callback", async (req, res) => {
    var code = req.query.code;

     request({
        uri: "https://api.fitbit.com/oauth2/token",
        method: 'POST',
        headers: { Authorization: 'Basic ' + new Buffer(config.client_id + ":" + config.client_secret).toString('base64') },
    timeout: 10000,
        form: {
            code: code,
            redirect_uri: "https://localhost:8080/callback",
            grant_type: 'authorization_code',
            client_id: config.client_id,
            client_secret: config.client_secret,
        }
    }, function( err, _res, body ) {
        if ( err ) return res.send(err.message);
        try {
            var token = JSON.parse(body);
            res.cookie("fitbitToken", token.access_token)
            res.redirect("/export");
        } catch( err ) {
            res.send(err.message);
        }
    });
});

app.get("/export", function (req, res) {
    if (!req.query.start || !req.query.duration || !req.query.distance) {
        res.sendFile("./export.html", { root: __dirname });
        return;
    } else if (!req.cookies || !req.cookies.fitbitToken) {
        res.redirect("/auth");
        return;
    }

    var token = req.cookies.fitbitToken;
    var start = moment(req.query.start, "YYYY-MM-DD HH:mm:ss");
    var duration = parseInt(req.query.duration); // seconds
    var distance = parseFloat(req.query.distance); // miles

    var end = moment(start).add(duration, "seconds");

    var url = "https://api.fitbit.com/1/user/-/activities/heart/date/" + start.format("YYYY-MM-DD") + "/1d/1sec/time/" + start.format("HH:mm:ss") + "/" + end.format("HH:mm:ss") + ".json"

    request({
        uri: url,
        method: "GET",
        headers: { Authorization: "Bearer " + token },
    }, function (err, _res, body) {
        if ( err ) return res.send(err.message);
        try {
            var hr = JSON.parse(body);
            var tcx = FitbitToTCX(hr, start, duration, distance);

            res.writeHead(200, {
                "Content-Type": "application/force-download",
                "Content-disposition": "attachment; filename=activity.tcx",
            });
            res.end(tcx);

        } catch(err) {
          console.error(err);
        }
    });
});

app.get("/", function (req, res) {
    res.redirect("/auth");
});

var key = fs.readFileSync('./key.pem');
var cert = fs.readFileSync('./cert.pem');

var server = https.createServer({key: key, cert: cert}, app);
server.listen(8080, function () {
    console.log("Running...");
});
