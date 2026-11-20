(function(){
  function LatLng(a,b){this.a=a;this.b=b;}
  function Bounds(){} Bounds.prototype.extend=function(){};
  function Map(el){ this.el=el; el.innerHTML='<div class="stubmap" style="position:absolute;inset:0;overflow:auto;padding:8px;display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start"></div>'; }
  Map.prototype={setCenter(){},setLevel(){},addControl(){},relayout(){},setBounds(){}};
  function Overlay(o){ this.o=o; const host=o.map.el.querySelector('.stubmap'); if(o.content instanceof HTMLElement){ host.appendChild(o.content); this.node=o.content; } }
  Overlay.prototype.setMap=function(m){ if(!m&&this.node) this.node.remove(); };
  const B=[37.4993,126.9203];
  const cats=["음식점 > 한식 > 육류,고기 > 삼겹살","음식점 > 술집 > 일본식주점","음식점 > 카페","음식점 > 한식 > 육류,고기 > 곱창,막창","음식점 > 일식 > 초밥,롤","음식점 > 한식"];
  const docs=Array.from({length:16},(_,i)=>({id:String(800000+i),place_name:"근처가게"+i,category_name:cats[i%6],
    x:String(B[1]+i*0.0005),y:String(B[0]+i*0.0003),road_address_name:"서울 관악구 테스트로 "+i,phone:i%2?"02-111-"+i:""}));
  window.__docs=docs;
  function Places(){}
  Places.prototype.categorySearch=(c,cb)=>setTimeout(()=>cb(docs.slice(0,15),"OK",{hasNextPage:false,current:1}),20);
  Places.prototype.keywordSearch=(q,cb)=>setTimeout(()=>{
    if(["고기집","곱창","이자카야","횟집","중식","술집","한식"].includes(q)) return cb(docs.slice(10),"OK",{hasNextPage:false,current:1});
    cb([{id:"7"+Math.abs([...q].reduce((a,c)=>a*31+c.charCodeAt(0)|0,0)),place_name:q,category_name:"음식점 > 한식",x:"126.9212",y:"37.4998",road_address_name:"서울 관악구 옛가게로 1",phone:""}],"OK");
  },15);
  function Geocoder(){} Geocoder.prototype.addressSearch=(a,cb)=>setTimeout(()=>cb(a.includes("마포")?[{x:"126.9515",y:"37.5443"}]:[{x:"126.9203",y:"37.4993"}],"OK"),5);
  window.kakao={maps:{load:f=>f(),LatLng,LatLngBounds:Bounds,Map,CustomOverlay:Overlay,ZoomControl:function(){},ControlPosition:{RIGHT:1},
    services:{Places,Geocoder,Status:{OK:"OK"},SortBy:{DISTANCE:"d"}}}};
})();
