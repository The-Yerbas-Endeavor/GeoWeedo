export const DISPENSARY_LICENSE_TYPES=[
 {id:'dispensary',label:'Dispensary / storefront'},
 {id:'delivery',label:'Delivery'},
 {id:'medical',label:'Medical cannabis'},
 {id:'adult_use',label:'Adult-use / recreational'},
 {id:'cultivation',label:'Cultivation / grower'},
 {id:'manufacturing',label:'Manufacturing / processing'},
 {id:'distribution',label:'Distribution / transport'},
 {id:'testing',label:'Testing / laboratory'},
 {id:'microbusiness',label:'Microbusiness'},
 {id:'other',label:'Other'},
] as const;

export type DispensaryLicenseType=(typeof DISPENSARY_LICENSE_TYPES)[number]['id'];
export const DISPENSARY_LICENSE_TYPE_IDS=new Set<string>(DISPENSARY_LICENSE_TYPES.map(x=>x.id));
