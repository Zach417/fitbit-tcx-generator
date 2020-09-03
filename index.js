var fs = require('fs');
var https = require('https');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var request = require('request');
var moment = require('moment');

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

function FitbitToTCX (data, start, duration, dist_miles) {
    var hr = data["activities-heart-intraday"].dataset;

    var calories_burned = 0;
    for (var i = 0; i < data["activities-heart"].length; i++) {
        for (var j = 0; j < data["activities-heart"][i].heartRateZones.length; j++) {
            calories_burned += data["activities-heart"][i].heartRateZones[j].caloriesOut;
        }
    }

    dist_miles += 0.05; // fixes rounding issues
    var meters_per_mile = 1609.344;
    var dist_meters = dist_miles * meters_per_mile;
    var calories_per_mile = dist_miles / calories_burned;
    var altitude_meters = 450;
    var meters_second = dist_meters / duration;

    var tcx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>' + moment(start).format("YYYY-MM-DD") + 'T' + moment(start).format("HH:mm:ss") + '.000-06:00</Id>';

    dur_sum = 0;
    dist_sum = 0;
    lap_dist_sum = 0;
    lap_dur_sum = 0;

    var laps = [];

    // set parameters
    for (var i = 0; i < hr.length; i++) {i
        prev_time = moment(start);
        if (i > 0) {
            prev_time = moment(start.format("YYYY-MM-DD ") + hr[i-1].time);
        }

        hr[i].date = moment(start.format("YYYY-MM-DD ") + hr[i].time);
        hr[i].secondDiff = hr[i].date.diff(prev_time, 'seconds');
        hr[i].dist = hr[i].secondDiff * meters_second;

        dist_sum += hr[i].dist;
        dur_sum += hr[i].secondDiff;
        lap_dist_sum += hr[i].dist;
        lap_dur_sum += hr[i].secondDiff;

        hr[i].dist_sum = dist_sum;

        hr[i].lap = Math.floor(dist_sum / meters_per_mile) + 1;
        if (hr[i].lap < 1) hr[i].lap = 1;

        if (hr[i].date.isBefore(start)) {
          break;
        }

        if (i > 0 && hr[i].lap > hr[i-1].lap) {
            laps.push({
              dist: lap_dist_sum - hr[i].dist,
              duration: lap_dur_sum - hr[i].secondDiff,
              calories: (lap_dist_sum - hr[i].dist) / dist_meters * calories_burned,
            });

            lap_dist_sum = hr[i].dist;
            lap_dur_sum = hr[i].secondDiff;
        }
    }

    laps.push({
        dist: lap_dist_sum + (dist_meters - dist_sum),
        duration: lap_dur_sum + (duration - dur_sum),
        calories: (lap_dist_sum + (dist_meters - dist_sum)) / dist_meters * calories_burned,
    });

    dist_sum = dist_meters;

    for (var i = 0; i < hr.length; i++) {
      if (hr[i].date.isBefore(start)) {
        break;
      }

      if (i == 0 || hr[i].lap > hr[i-1].lap) {
          tcx += '<Lap StartTime="' + start.format("YYYY-MM-DD") + 'T' + hr[i].time + '.000-06:00"><TotalTimeSeconds>' + laps[hr[i].lap-1].duration + '</TotalTimeSeconds><DistanceMeters>' + laps[hr[i].lap-1].dist + '</DistanceMeters><Calories>' + laps[hr[i].lap-1].calories + '</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod><Track>';
      }

      tcx += '<Trackpoint><Time>' + start.format("YYYY-MM-DD") + 'T' + hr[i].time + '.000-06:00</Time><Position><LatitudeDegrees></LatitudeDegrees><LongitudeDegrees></LongitudeDegrees></Position><AltitudeMeters>' + altitude_meters + '</AltitudeMeters><DistanceMeters>' + hr[i].dist_sum + '</DistanceMeters><HeartRateBpm><Value>' + hr[i].value + '</Value></HeartRateBpm></Trackpoint>';

      if (i == hr.length - 1 || hr[i+1].lap > hr[i].lap) {
          tcx += "</Track></Lap>";
      }
    }

    tcx += '<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Fitbit Ionic</Name><UnitId>0</UnitId><ProductID>0</ProductID></Creator></Activity></Activities></TrainingCenterDatabase>';

    return tcx;
}

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
    res.send('Hello<br><a href="/auth">Log in with Fitbit</a>');
});

var key = fs.readFileSync('./key.pem');
var cert = fs.readFileSync('./cert.pem');

var server = https.createServer({key: key, cert: cert}, app);
server.listen(8080, function () {
    console.log("Running...");
});
