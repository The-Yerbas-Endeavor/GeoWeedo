export const ADMIN_PERMISSIONS=[
  'dashboard.view',
  'locations.view',
  'locations.manage',
  'data.manage',
  'users.view',
  'users.manage',
  'rewards.manage',
  'sponsorships.manage',
  'finance.view',
  'finance.withdrawals',
  'system.manage',
  'staff.manage',
] as const;

export type AdminPermission=(typeof ADMIN_PERMISSIONS)[number];
export type AdminRole='admin'|'moderator';

export const ROLE_PERMISSIONS:Record<AdminRole,AdminPermission[]>={
  admin:[...ADMIN_PERMISSIONS],
  moderator:[
    'dashboard.view',
    'locations.view',
    'locations.manage',
    'users.view',
    'sponsorships.manage',
  ],
};

export const PERMISSION_LABELS:Record<AdminPermission,string>={
  'dashboard.view':'View admin dashboard',
  'locations.view':'View dispensaries and candidates',
  'locations.manage':'Edit locations, imagery, and candidate reviews',
  'data.manage':'Run official imports and data maintenance',
  'users.view':'View player accounts',
  'users.manage':'Change player account status/details',
  'rewards.manage':'Manage gameplay reward policy and reward ledger',
  'sponsorships.manage':'Manage sponsorships',
  'finance.view':'View wallet and finance information',
  'finance.withdrawals':'Review or process withdrawals',
  'system.manage':'Database/system administration',
  'staff.manage':'Create staff and change roles/permissions',
};

export function normalizeAdminRole(value?:string|null):AdminRole{return value==='moderator'?'moderator':'admin';}

export function effectivePermissions(role?:string|null,permissionsJson?:string|null):AdminPermission[]{
  const normalized=normalizeAdminRole(role);
  if(normalized==='admin')return [...ADMIN_PERMISSIONS];
  if(!permissionsJson)return [...ROLE_PERMISSIONS.moderator];
  try{
    const parsed=JSON.parse(permissionsJson);
    if(!Array.isArray(parsed))return [...ROLE_PERMISSIONS.moderator];
    return parsed.filter((value):value is AdminPermission=>ADMIN_PERMISSIONS.includes(value as AdminPermission));
  }catch{return [...ROLE_PERMISSIONS.moderator];}
}

export function permissionForAdminRequest(pathname:string,method:string):AdminPermission|null{
  const verb=method.toUpperCase();
  if(pathname.startsWith('/api/admin/auth/'))return null;
  if(pathname.startsWith('/api/admin/staff'))return 'staff.manage';
  if(pathname.startsWith('/api/admin/database'))return 'system.manage';
  if(pathname.includes('/fetch-official')||pathname.includes('/pipeline'))return 'data.manage';
  if(pathname.startsWith('/api/admin/candidates'))return verb==='GET'?'locations.view':'locations.manage';
  if(pathname.startsWith('/api/admin/dispensaries')||pathname.startsWith('/api/admin/geocode')||pathname.startsWith('/api/admin/imagery'))return verb==='GET'?'locations.view':'locations.manage';
  if(pathname.startsWith('/api/admin/users'))return verb==='GET'?'users.view':'users.manage';
  if(pathname.startsWith('/api/admin/rewards'))return 'rewards.manage';
  if(pathname.startsWith('/api/admin/sponsorships'))return 'sponsorships.manage';
  if(pathname.startsWith('/api/admin/withdrawals'))return 'finance.withdrawals';
  if(pathname.startsWith('/api/admin/wallet'))return 'finance.view';
  return 'dashboard.view';
}
