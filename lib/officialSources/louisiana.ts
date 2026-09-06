import 'server-only';

type LouisianaCandidate={name:string;streetAddress:string;city:string;region:string;country:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://ldh.la.gov/page/medical-marijuana';

// LDH currently returns HTTP 403 to ordinary server-side fetches even though the
// official Medical Marijuana page publicly publishes these tables. Keep the
// current LDH-published retailer roster here so GeoWeedo's automated sync does
// not depend on scraping a page that deliberately blocks our backend request.
// Update this snapshot whenever LDH changes the public retailer tables.
const LDH_RETAILERS:[string,string,string][]=[
 ['H & W Acquisition Company LLC','1667 Tchoupitoulas Blvd., Suite B','New Orleans'],
 ['Crescent City Therapeutics, LLC','100 W. Airline Hwy','Kenner'],
 ['Capitol Wellness Solutions, LLC','8037 Picardy Avenue','Baton Rouge'],
 ['Green Leaf Dispensary, LLC','174 Arlington Street','Morgan City'],
 ['The Apothecary Shoppe, LLC','620 Guilbeau Road, Suite A','Lafayette'],
 ['Medicis, LLC',"3005 L'Auberge Blvd.",'Lake Charles'],
 ['The Medicine Cabinet Pharmacy, LLC','403 Bolton Avenue','Alexandria'],
 ['Hope Pharmacy, LLC','4590 E. Texas Street','Bossier City'],
 ['Delta Medmar, LLC','1707 McKeen Place','Monroe'],
 ['Willow Pharmacy, Inc.','69090 Highway 190 Service Road','Covington'],
 ['H & W Acquisition Company LLC','5055 Veterans Memorial Blvd.','Metairie'],
 ['Crescent City Therapeutics, LLC','1407 S. Carrollton Avenue','New Orleans'],
 ['Capitol Wellness Solutions, LLC',"1940 O'Neal Lane",'Baton Rouge'],
 ['Capitol Wellness Solutions, LLC','17097 Airline Hwy','Prairieville'],
 ['Green Leaf Dispensary, LLC','6048 W. Park Avenue','Houma'],
 ['The Apothecary Shoppe, LLC','4079 I-49 S. Service Road','Opelousas'],
 ['The Apothecary Shoppe, LLC','1700 Center Street','New Iberia'],
 ['Medicis, LLC','1920 Evangeline Road','Jennings'],
 ['Medicis, LLC','303 South Cities Service Hwy.','Sulphur'],
 ['The Medicine Cabinet Pharmacy, LLC','114 E. Main Street','Marksville'],
 ['The Medicine Cabinet Pharmacy, LLC','111 W. Harriet Street','Leesville'],
 ['Hope Pharmacy, LLC','5033 University Parkway','Natchitoches'],
 ['Hope Pharmacy, LLC','9352 Mansfield Road','Shreveport'],
 ['Delta Medmar, LLC','111 McMillian Road','West Monroe'],
 ['Delta Medmar, LLC','746 Celebrity Drive','Ruston'],
 ['Willow Pharmacy, Inc.','796 East I-10 Service Road','Slidell'],
 ['Willow Pharmacy, Inc.','1410 SW Railroad Avenue','Hammond'],
];

export async function fetchLouisianaCandidates():Promise<LouisianaCandidate[]>{
 if(LDH_RETAILERS.length<25)throw new Error(`Louisiana LDH snapshot contains only ${LDH_RETAILERS.length} retailer locations; refusing a likely partial import.`);
 return LDH_RETAILERS.map(([name,streetAddress,city])=>({
  name,
  streetAddress,
  city,
  region:'Louisiana',
  country:'USA',
  dataSource:'Louisiana LDH Medical Marijuana Retailers',
  sourceUrl:SOURCE_URL,
  sourceLicense:'Official Louisiana Department of Health Medical Marijuana retailer tables; base permits and satellite locations. Snapshot is used because LDH currently returns HTTP 403 to GeoWeedo server-side requests.',
  imageryStatus:'missing_coordinates',
 }));
}
