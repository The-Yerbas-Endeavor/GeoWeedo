'use client';

import {useState} from 'react';
import MapLibreGuessMap,{type LatLng,type MapLocation} from '@/components/GuessMapLegacy';
import GoogleGuessMap from '@/components/GoogleGuessMap';

export type {LatLng,MapLocation};

type Props={guess:LatLng|null;actual?:LatLng|null;revealed?:boolean;onGuess:(guess:LatLng)=>void;locations?:MapLocation[];browseMode?:boolean;mappedTotal?:number;countriesTotal?:number;enabledTotal?:number;showAllMappedPins?:boolean};

export default function GuessMapRouter(props:Props){
 const[googleUnavailable,setGoogleUnavailable]=useState(false);
 if(props.browseMode||googleUnavailable)return <MapLibreGuessMap {...props}/>;
 return <GoogleGuessMap guess={props.guess} actual={props.actual} revealed={props.revealed} onGuess={props.onGuess} onUnavailable={()=>setGoogleUnavailable(true)}/>;
}
