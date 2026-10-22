export interface Control { id:string;tag:string;text:string;label?:string|null;role?:string|null;href?:string|null;placeholder?:string|null;state?:string|null;controls?:string|null }
export interface Capture { route:string;url:string;title:string;html:string;css?:string;bodyClass:string;htmlClass:string;text:string;controls:Control[];publicInteractions?:PublicInteractions;tabs?:{label:string;route:string}[] }
export interface RouteEntry { route:string;file:string;title:string;sourceUrl:string;status:'captured'|'source-404'|'redirect';textLength:number }
export interface LocalRecord { id:string;name:string;createdAt:string;kind:string;[key:string]:string }
export interface DialogRequest { title:string;route:string;kind?:string;template?:string;description?:string }
export interface DialogResult { title:string;route:string;values:Record<string,string>;record?:LocalRecord;records?:LocalRecord[] }
export interface PublicPanel {label:string;panelHtml:string;panelTag?:string;panelId?:string;group?:string;triggerHtml?:string}
export interface PublicMenu extends PublicPanel {links:{text:string;href:string|null}[]}
export interface PublicInteractions {route:string;accordions:PublicPanel[];tabs:PublicPanel[];menus:PublicMenu[]}
