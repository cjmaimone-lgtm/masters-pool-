// One-time script to add birthYear field to golfers.json
const fs = require('fs');
const path = require('path');

const GOLFERS_FILE = path.join(__dirname, '..', 'data', 'golfers.json');
const golfers = JSON.parse(fs.readFileSync(GOLFERS_FILE, 'utf8'));

const birthYears = {
  "Scottie Scheffler": 1996, "Rory McIlroy": 1989, "Cameron Young": 1997,
  "Tommy Fleetwood": 1991, "Xander Schauffele": 1993, "Matt Fitzpatrick": 1994,
  "Justin Rose": 1980, "Collin Morikawa": 1997, "Russell Henley": 1989,
  "Chris Gotterup": 1999, "Robert MacIntyre": 1996, "Sepp Straka": 1993,
  "J.J. Spaun": 1990, "Hideki Matsuyama": 1992, "Justin Thomas": 1993,
  "Ben Griffin": 1995, "Jacob Bridgeman": 2000, "Ludvig Aberg": 1999,
  "Alexander Noren": 1982, "Harris English": 1989, "Viktor Hovland": 1997,
  "Akshay Bhatia": 2002, "Patrick Reed": 1990, "Bryson DeChambeau": 1993,
  "Keegan Bradley": 1986, "Maverick McNealy": 1995, "Ryan Gerard": 2000,
  "Jon Rahm": 1994, "Si Woo Kim": 1995, "Tyrrell Hatton": 1991,
  "Min Woo Lee": 1998, "Shane Lowry": 1987, "Sam Burns": 1996,
  "Patrick Cantlay": 1992, "Kurt Kitayama": 1992, "Marco Penge": 1997,
  "Nicolas Echavarria": 1994, "Aaron Rai": 1994, "Corey Conners": 1992,
  "Jason Day": 1987, "Michael Brennan": 2002, "Ryan Fox": 1986,
  "Brian Harman": 1987, "Kristoffer Reitan": 1999, "Andrew Novak": 1996,
  "Sam Stevens": 2000, "Adam Scott": 1980, "Rasmus Hojgaard": 2000,
  "Michael Kim": 1993, "Sami Valimaki": 1998, "Max Greyserman": 1995,
  "Jordan Spieth": 1993, "Harry Hall": 1997, "Nick Taylor": 1988,
  "Rasmus Neergaard-Petersen": 2001, "Sungjae Im": 1998, "Casey Jarvis": 2003,
  "Wyndham Clark": 1993, "Johnny Keefer": 2003, "Aldrich Potgieter": 2005,
  "Hao-Tong Li": 1995, "Tom McKibbin": 2002, "Brian Campbell": 2002,
  "Davis Riley": 1996, "Max Homa": 1990, "Carlos Ortiz": 1991,
  "Brooks Koepka": 1990, "Jackson Herrington": 2004, "Naoyuki Kataoka": 2003,
  "Zach Johnson": 1976, "Tiger Woods": 1975, "Danny Willett": 1987,
  "Mike Weir": 1970, "Bubba Watson": 1978, "Brandon Holtz": null,
  "Fifa Laopakdee": null, "Angel Cabrera": 1969, "Phil Mickelson": 1970,
  "Mateo Pulcini": null, "Jose Maria Olazabal": 1966, "Cameron Smith": 1993,
  "Vijay Singh": 1963, "Dustin Johnson": 1984, "Charl Schwartzel": 1984,
  "Mason Howell": null, "Ethan Fang": null, "Sergio Garcia": 1980,
  "Fred Couples": 1959
};

golfers.forEach(g => {
  g.birthYear = birthYears[g.name] || null;
});

fs.writeFileSync(GOLFERS_FILE, JSON.stringify(golfers, null, 2));
console.log('Birth years added to', golfers.length, 'golfers');
