window.Kakao={_i:false,init(){this._i=true},isInitialized(){return this._i},Share:{sendDefault(o){window.__shared=o;},
    uploadImage(o){window.__uploaded=o.file&&o.file.length;
      return Promise.resolve({infos:{original:{url:'https://k.kakaocdn.net/fake/wheel.png',width:800,height:860}}});}}};
