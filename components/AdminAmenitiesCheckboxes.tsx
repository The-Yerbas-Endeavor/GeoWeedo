'use client';

import {useEffect} from 'react';

const AMENITIES=[
  'In-store shopping','Curbside pickup','Online ordering','Delivery','Drive-thru','Express pickup',
  'ATM on site','Debit cards','Cashless payment','Wheelchair accessible','On-site parking','Security on site',
  'Loyalty program','Daily deals','First-time customer discount','Veteran discount','Senior discount',
  'Consultation available','Pre-order pickup','Pet friendly'
];

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  setter?.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}

export default function AdminAmenitiesCheckboxes(){
  useEffect(()=>{
    let disposed=false;
    const enhance=()=>{
      if(disposed)return;
      const input=Array.from(document.querySelectorAll<HTMLInputElement>('.full-dispensary-editor .admin-form input')).find(el=>el.placeholder==='Amenities / services, comma separated');
      if(!input||input.dataset.amenitiesEnhanced==='true')return;
      input.dataset.amenitiesEnhanced='true';
      input.type='hidden';

      const block=document.createElement('div');
      block.className='admin-amenities-block';
      const title=document.createElement('strong');
      title.className='admin-choice-title';
      title.textContent='Amenities & services';
      const grid=document.createElement('div');
      grid.className='admin-choice-grid';
      block.append(title,grid);
      input.insertAdjacentElement('afterend',block);

      const selected=()=>new Set(input.value.split(',').map(v=>v.trim()).filter(Boolean));
      const render=()=>{
        const current=selected();
        grid.replaceChildren();
        for(const amenity of AMENITIES){
          const label=document.createElement('label');
          label.className='admin-choice-option';
          const checkbox=document.createElement('input');
          checkbox.type='checkbox';
          checkbox.checked=current.has(amenity);
          const text=document.createElement('span');text.textContent=amenity;
          checkbox.addEventListener('change',()=>{
            const next=selected();
            if(checkbox.checked)next.add(amenity);else next.delete(amenity);
            setReactInputValue(input,Array.from(next).join(', '));
          });
          label.append(checkbox,text);grid.appendChild(label);
        }
      };
      render();
    };

    enhance();
    const observer=new MutationObserver(()=>enhance());
    observer.observe(document.body,{subtree:true,childList:true});
    return()=>{disposed=true;observer.disconnect();};
  },[]);
  return null;
}
