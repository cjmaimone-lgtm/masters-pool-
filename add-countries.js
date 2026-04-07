// One-time script to add country field to golfers.json
const fs = require('fs');
const path = require('path');

const GOLFERS_FILE = path.join(__dirname, '..', 'data', 'golfers.json');
const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));

const countries = {
  "Scottie Scheffler": "USA", "Rory McIlroy": "NIR", "Cameron Young": "USA",
  "Tommy Fleetwood": "ENG", "Xander Schauffele": "USA", "Matt Fitzpatrick": "ENG",
  "Justin Rose": "ENG", "Collin Morikawa": "USA", "Russell Henley": "USA",
  "Chris Gotterup": "USA", "Robert MacIntyre": "SCO", "Sepp Straka": "AUT",
  "J.J. Spaun": "USA", "Hideki Matsuyama": "JPN", "Justin Thomas": "USA",
  "Ben Griffin": "USA", "Jacob Bridgeman": "USA", "Ludvig Aberg": "SWE",
  "Alexander Noren": "SWE", "Harris English": "USA", "Viktor Hovland": "NOR",
  "Akshay Bhatia": "USA", "Patrick Reed": "USA", "Bryson DeChambeau": "USA",
  "Keegan Bradley": "USA", "Maverick McNealy": "USA", "Ryan Gerard": "USA",
  "Jon Rahm": "ESP", "Si Woo Kim": "KOR", "Tyrrell Hatton": "ENG",
  "Min Woo Lee": "AUS", "Shane Lowry": "IRL", "Sam Burns": "USA",
  "Patrick Cantlay": "USA", "Kurt Kitayama": "USA", "Marco Penge": "ENG",
  "Nicolas Echavarria": "COL", "Aaron Rai": "ENG", "Corey Conners": "CAN",
  "Jason Day": "AUS", "Michael Brennan": "USA", "Ryan Fox": "NZL",
  "Brian Harman": "USA", "Kristoffer Reitan": "NOR", "Andrew Novak": "USA",
  "Sam Stevens": "USA", "Adam Scott": "AUS", "Rasmus Hojgaard": "DEN",
  "Michael Kim": "USA", "Sami Valimaki": "FIN", "Max Greyserman": "USA",
  "Jordan Spieth": "USA", "Harry Hall": "ENG", "Nick Taylor": "CAN",
  "Rasmus Neergaard-Petersen": "DEN", "Sungjae Im": "KOR", "Casey Jarvis": "RSA",
  "Wyndham Clark": "USA", "Johnny Keefer": "USA", "Aldrich Potgieter": "RSA",
  "Hao-Tong Li": "CHN", "Tom McKibbin": "NIR", "Ben Campbell": "NZL",
  "Davis Riley": "USA", "Max Homa": "USA", "Carlos Ortiz": "MEX",
  "Brooks Koepka": "USA", "Jackson Herrington": "USA", "Naoyuki Kataoka": "JPN",
  "Zach Johnson": "USA", "Tiger Woods": "USA", "Danny Willett": "ENG",
  "Mike Weir": "CAN", "Bubba Watson": "USA", "Brandon Holtz": "USA",
  "Fifa Laopakdee": "THA", "Angel Cabrera": "ARG", "Phil Mickelson": "USA",
  "Mateo Pulcini": "ARG", "Jose Maria Olazabal": "ESP", "Cameron Smith": "AUS",
  "Vijay Singh": "FJI", "Dustin Johnson": "USA", "Charl Schwartzel": "RSA",
  "Mason Howell": "USA", "Ethan Fang": "USA", "Sergio Garcia": "ESP",
  "Fred Couples": "USA", "Tony Finau": "USA", "Will Zalatoris": "USA",
  "Jake Knapp": "USA", "Nicolai Hojgaard": "DEN", "Gary Woodland": "USA",
  "Daniel Berger": "USA", "Matt McCarty": "USA", "Brandon Wu": "USA",
  "Joaquin Niemann": "CHI", "Sahith Theegala": "USA", "Thomas Detry": "BEL",
  "Joohyung Kim": "KOR", "Anthony Kim": "USA", "Billy Horschel": "USA",
  "Taylor Pendrith": "CAN", "Byeong Hun An": "KOR", "Davis Thompson": "USA",
  "Jayden Trey Schaper": "RSA", "Pierceson Coody": "USA", "Denny McCarthy": "USA"
};

golfers.forEach(g => {
  g.country = countries[g.name] || null;
});

fs.writeFileSync(GOLFERS_FILE, JSON.stringify(golfers, null, 2));
const found = golfers.filter(g => g.country).length;
const missing = golfers.filter(g => !g.country).length;
console.log(`Countries added: ${found} golfers, ${missing} missing`);
