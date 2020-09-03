var moment = require('moment');

module.exports = function (data, start, duration, dist_miles) {
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
