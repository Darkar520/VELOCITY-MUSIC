// Editorial starting points, not inferred listening history or artist portraits.
const ROSTERS = {
  EDM: ['Avicii','Calvin Harris','Skrillex','Martin Garrix','David Guetta','Swedish House Mafia','Zedd','Tiësto','deadmau5','Porter Robinson','Madeon','ILLENIUM','Alesso','ODESZA','Disclosure','Eric Prydz'],
  Rock: ['Queen','Pink Floyd','The Beatles','Led Zeppelin','Radiohead','The Doors','Nirvana','Foo Fighters','Muse','Red Hot Chili Peppers','The Rolling Stones','Paramore','Arctic Monkeys','The Strokes','Oasis','Pearl Jam'],
  Metal: ['Metallica','Deftones','Iron Maiden','Black Sabbath','System Of A Down','Slipknot','Linkin Park','Tool','Korn','Gojira','Megadeth','Judas Priest','Evanescence','Bring Me The Horizon','Alice In Chains','Rammstein'],
  'Rock Alternativo': ['Radiohead','Deftones','Paramore','Muse','Nirvana','The Smashing Pumpkins','Placebo','Garbage','Weezer','Queens of the Stone Age','Incubus','The Cure'],
  'Rock en Español': ['Soda Stereo','Gustavo Cerati','Zoé','Caifanes','Héroes del Silencio','Enanitos Verdes','Café Tacvba','Los Bunkers','Babasónicos','Fito Páez','Andrés Calamaro','Mikel Erentxun'],
  Electrónica: ['Daft Punk','Justice','The Chemical Brothers','The Prodigy','Aphex Twin','Massive Attack','RÜFÜS DU SOL','Kraftwerk','Four Tet','Bonobo','Bicep','Jamie xx'],
  House: ['Disclosure','Peggy Gou','FISHER','Chris Lake','John Summit','Fred again..','Dom Dolla','Duke Dumont','MK','Purple Disco Machine','Frankie Knuckles','Kerri Chandler'],
  Techno: ['Carl Cox','Charlotte de Witte','Amelie Lens','Jeff Mills','Richie Hawtin','Adam Beyer','Nina Kraviz','Boris Brejcha','Paul Kalkbrenner','Kölsch','Reinier Zonneveld','Deborah De Luca'],
  Pop: ['Taylor Swift','Lady Gaga','Dua Lipa','Ariana Grande','Billie Eilish','Olivia Rodrigo','Michael Jackson','Madonna','Bruno Mars','The Weeknd','Sabrina Carpenter','Harry Styles'],
  'Hip-Hop': ['Kendrick Lamar','J. Cole','Drake','Eminem','Nas','2Pac','Jay-Z','Tyler, The Creator','Travis Scott','A$AP Rocky','Outkast','Kanye West'],
  Reggaetón: ['Bad Bunny','Daddy Yankee','Karol G','Rauw Alejandro','Don Omar','Tego Calderón','Wisin & Yandel','J Balvin','Feid','Ozuna','Ivy Queen','Nicky Jam'],
  Indie: ['Tame Impala','Arctic Monkeys','The Strokes','The Smiths','Beach House','Mac DeMarco','Clairo','Mitski','Phoebe Bridgers','Vampire Weekend','MGMT','The xx'],
  Punk: ['Green Day','blink-182','The Clash','Ramones','The Offspring','Sum 41','Bad Religion','NOFX','Rancid','Sex Pistols','Misfits','Turnstile'],
  Jazz: ['Miles Davis','John Coltrane','Ella Fitzgerald','Nina Simone','Bill Evans','Chet Baker','Duke Ellington','Thelonious Monk','Louis Armstrong','Herbie Hancock','Chick Corea','Kamasi Washington'],
};
Object.assign(ROSTERS, {
 'Regional Mexicano':['Vicente Fernández','Alejandro Fernández','Carín León','Christian Nodal','Grupo Frontera','Banda MS','Julión Álvarez','Pepe Aguilar'],
 'Corridos Tumbados':['Peso Pluma','Natanael Cano','Junior H','Fuerza Regida','Gabito Ballesteros','Luis R Conriquez','Oscar Maydon','Eslabon Armado'],
 'Pop Latino':['Shakira','Juanes','Ricky Martin','Julieta Venegas','Alejandro Sanz','Luis Fonsi','Belanova','Miranda!'],
 'Trap Latino':['Bad Bunny','Duki','Anuel AA','Eladio Carrión','Trueno','Ysy A','Cazzu','Milo j'],
 Salsa:['Héctor Lavoe','Rubén Blades','Celia Cruz','Willie Colón','Marc Anthony','Gilberto Santa Rosa','Grupo Niche','El Gran Combo de Puerto Rico'],
 Bachata:['Romeo Santos','Aventura','Prince Royce','Juan Luis Guerra','Monchy & Alexandra','Luis Vargas','Frank Reyes','Zacarías Ferreira'],
 Cumbia:['Los Ángeles Azules','Grupo Cañaveral','La Sonora Dinamita','Grupo 5','Los Mirlos','La Delio Valdez','Celso Piña','Chico Trujillo'],
 Merengue:['Juan Luis Guerra','Elvis Crespo','Olga Tañón','Wilfrido Vargas','Sergio Vargas','Toño Rosario','Johnny Ventura','Milly Quezada'],
 'Rap en Español':['Residente','Canserbero','Nach','Kase.O','SFDK','Violadores del Verso','Akapellah','Santa Fe Klan'],
 Trap:['Travis Scott','Future','Young Thug','Gucci Mane','21 Savage','Migos','Lil Uzi Vert','Playboi Carti'],
 'R&B':['SZA','Frank Ocean','The Weeknd','Usher','Alicia Keys','Beyoncé','Aaliyah','Miguel'],
 'Lo-Fi':['Nujabes','J Dilla','Jinsang','idealism','Kupla','Tomppabeats','eevee','potsu'],
 'K-Pop':['BTS','BLACKPINK','TWICE','Stray Kids','EXO','NewJeans','SEVENTEEN','Red Velvet'],
 Afrobeats:['Burna Boy','Wizkid','Davido','Rema','Tems','Ayra Starr','Asake','Tiwa Savage'],
 Amapiano:['Kabza De Small','DJ Maphorisa','Focalistic','Uncle Waffles','Young Stunna','Major League DJz','Tyla','DBN Gogo'],
 Soul:['Aretha Franklin','Marvin Gaye','Stevie Wonder','Otis Redding','Al Green','Sam Cooke','Etta James','Curtis Mayfield'],
 Funk:['James Brown','Parliament','Funkadelic','Prince','Sly & The Family Stone','Earth, Wind & Fire','The Meters','Kool & The Gang'],
 Disco:['Donna Summer','Chic','Bee Gees','Gloria Gaynor','Sister Sledge','Boney M.','Diana Ross','Sylvester'],
 Baladas:['Luis Miguel','José José','Camilo Sesto','Rocío Dúrcal','Ricardo Montaner','Cristian Castro','Laura Pausini','Sin Bandera'],
 Clásica:['Ludwig van Beethoven','Wolfgang Amadeus Mozart','Johann Sebastian Bach','Frédéric Chopin','Claude Debussy','Antonio Vivaldi','Pyotr Ilyich Tchaikovsky','Sergei Rachmaninoff'],
 Country:['Johnny Cash','Dolly Parton','Willie Nelson','Chris Stapleton','Kacey Musgraves','Zach Bryan','Shania Twain','Luke Combs'],
 Blues:['B.B. King','Muddy Waters','Howlin’ Wolf','Robert Johnson','Stevie Ray Vaughan','Buddy Guy','John Lee Hooker','Albert King'],
 Reggae:['Bob Marley & The Wailers','Peter Tosh','Jimmy Cliff','Burning Spear','Toots & The Maytals','Steel Pulse','Chronixx','Protoje'],
 Dembow:['El Alfa','Chimbala','Tokischa','Rochy RD','La Materialista','El Cherry Scom','Yomel El Meloso','Bulova'],
 'Neo Soul':['Erykah Badu','D’Angelo','Jill Scott','Maxwell','Musiq Soulchild','India.Arie','Cleo Sol','Jorja Smith'],
 Drill:['Pop Smoke','Chief Keef','Central Cee','Headie One','Fivio Foreign','King Von','Digga D','Unknown T'],
 Phonk:['Kordhell','DVRST','INTERWORLD','MoonDeity','LXST CXNTURY','Hensonn','Ghostface Playa','PlayaPhonk'],
 Flamenco:['Paco de Lucía','Camarón de la Isla','Estrella Morente','Enrique Morente','Niña Pastori','Tomatito','José Mercé','Vicente Amigo'],
 'Bossa Nova':['João Gilberto','Antônio Carlos Jobim','Astrud Gilberto','Nara Leão','Baden Powell','Vinicius de Moraes','Roberto Menescal','Carlos Lyra'],
 'Cumbia Villera':['Damas Gratis','Pibes Chorros','Yerba Brava','Flor de Piedra','Mala Fama','Supermerk2','La Base','Los Gedes'],
 Vallenato:['Diomedes Díaz','Jorge Celedón','Binomio de Oro de América','Los Diablitos','Silvestre Dangond','Peter Manjarrés','Rafael Orozco','Poncho Zuleta'],
 Grupero:['Los Bukis','Los Temerarios','Bronco','Grupo Bryndis','Los Acosta','Liberación','Los Caminantes','Los Rehenes'],
 Gospel:['Kirk Franklin','CeCe Winans','Tasha Cobbs Leonard','Yolanda Adams','Marvin Sapp','Donnie McClurkin','Fred Hammond','The Clark Sisters'],
});
const aliases = { 'Pop en Inglés':'Pop', Alternativo:'Rock Alternativo', 'Indie Pop':'Indie' };
export const artistIdentity = name => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function genreArtists(genres = []) {
  const groups = genres.map(g => (ROSTERS[aliases[g.label] || g.label] || []).map(name => ({name, genre:g.label, _key:artistIdentity(name), artistId:null, thumbnail:null})));
  const result=[], seen=new Set();
  for(let i=0;i<16;i++) for(const group of groups) {
    const a=group[i]; if(a && !seen.has(a._key)){seen.add(a._key);result.push(a);}
  }
  return result;
}
export function preferenceKey(prefs) {
  const genres=Array.isArray(prefs)?prefs:prefs?.genres || [];
  return JSON.stringify({genres:genres.map(g=>g.q).sort(),artists:(prefs?.artists || []).map(a=>artistIdentity(a.name)).sort()});
}
export function starterQueries(prefs) {
  const genres=Array.isArray(prefs)?prefs:prefs?.genres || [];
  const artists=prefs?.artists || [];
  const out=[];
  for(let tier=0;tier<3;tier++) for(let i=0;i<Math.max(genres.length,Math.min(artists.length,6));i++) {
    if(tier===0 && artists[i]?.name) out.push({label:artists[i].name,q:artists[i].name,kind:'artist'});
    const genre=genres[i];
    if(!genre?.q)continue;
    const roster=ROSTERS[aliases[genre.label] || genre.label];
    if(roster){const index=Math.min([0,4,10][tier],roster.length-1);out.push({label:genre.label,q:roster[index],artist:roster[index],kind:'genre'});}
    else if(tier===0)out.push({label:genre.label,q:genre.q,kind:'genre'});
  }
  return out.slice(0,24);
}
