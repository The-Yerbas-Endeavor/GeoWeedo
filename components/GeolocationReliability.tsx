'use client';

import { useEffect } from 'react';

export default function GeolocationReliability(){
  useEffect(()=>{
    const geo=navigator.geolocation;
    if(!geo)return;

    const original=geo.getCurrentPosition.bind(geo);
    let restored=false;

    const wrapped:Geolocation['getCurrentPosition']=(success,error,options)=>{
      const finishError=(err:GeolocationPositionError)=>{
        if(error)error(err);
      };

      const firstOptions:PositionOptions={
        enableHighAccuracy:false,
        maximumAge:Math.max(Number(options?.maximumAge||0),30*60*1000),
        timeout:Math.max(Number(options?.timeout||0),20000),
      };

      original(success,(firstError)=>{
        if(firstError.code===firstError.PERMISSION_DENIED){finishError(firstError);return;}
        const retryOptions:PositionOptions={
          enableHighAccuracy:true,
          maximumAge:0,
          timeout:25000,
        };
        original(success,finishError,retryOptions);
      },firstOptions);
    };

    try{
      Object.defineProperty(geo,'getCurrentPosition',{configurable:true,value:wrapped});
    }catch{
      return;
    }

    return()=>{
      if(restored)return;
      restored=true;
      try{Object.defineProperty(geo,'getCurrentPosition',{configurable:true,value:original});}catch{}
    };
  },[]);

  return null;
}
