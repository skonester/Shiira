const { app } = require('electron');
app.setName('Shiira');
require('./startup').enableCodeCache(app);
// A subsequent OS link launch is delivered to the existing browser process.
if (app.requestSingleInstanceLock()) require('./main');
else app.quit();
