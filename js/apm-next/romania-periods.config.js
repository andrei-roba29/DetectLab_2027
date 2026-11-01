/* Editable, approximate Romanian chronology for name-keyword inference.
 * Dates are review candidates, not facts about an individual site. Consulted references:
 * Radu & Schuster (eds.), "The Archaeology of Romania" (2013), and the
 * National Archaeological Repertory (RAN) period terminology. OPEN REVIEW REQUIRED.
 */
(function(root){
  'use strict';
  var config = {
    includeEmptyCoord: false,
    excludeNamePatterns: ['necropol','biserica','manastir','ruinele bisericii','cimitir','schit','capela'],
    periods: [
      {label:'Neolitic',start:-6500,end:-4500,keywords:['neolit','starcevo','cris','precucuteni'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Eneolitic / Chalcolitic',start:-4500,end:-3500,keywords:['eneolit','cotofeni','cucuteni','gumelnita','hamangia'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Epoca bronzului',start:-3500,end:-1200,keywords:['epoca bronzului','bronz','wietenberg','monteoru','noua'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Hallstatt',start:-1200,end:-500,keywords:['hallstatt'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Epoca fierului / La Tène',start:-500,end:-106,keywords:['latene','epoca fierului','geto-dac','getic'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Dacic',start:-500,end:106,keywords:['dacic','dacica','dava'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Roman',start:106,end:271,keywords:['epoca romana','roman','castru'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'},
      {label:'Medieval',start:900,end:1600,keywords:['medieval','feudal','voievodal'],source:'Radu & Schuster (eds.), The Archaeology of Romania (2013); approximate; review required.'}
    ]
  };
  root.DetectLabRomaniaApmConfig = config;
  if(typeof module==='object'&&module.exports) module.exports=config;
})(typeof self!=='undefined'?self:this);
