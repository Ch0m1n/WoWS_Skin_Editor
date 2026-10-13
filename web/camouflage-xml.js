import {t} from './i18n.js';

export const MAX_CAMOUFLAGE_XML_BYTES=32*1024*1024;
const originalNames=new WeakMap();
// Mod files can contain game group names such as <507C_group>, which standard
// DOM parsers reject. Skip comments, CDATA and processing instructions so their
// contents are never rewritten. Only element names receive an internal alias.
const numericTags=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([0-9][A-Za-z0-9_.:-]*)(?=[\s/>])/g;
export function parseCamouflageXML(text){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error(t('xmlExternalEntities'));
  let prefix='__wows_mod_tag_';while(text.includes(prefix))prefix='_'+prefix;
  const aliases=new Map();
  const normalized=text.replace(numericTags,(match,name)=>{
    if(!name)return match;
    const alias=prefix+[...name].map(c=>c.codePointAt(0).toString(16)).join('_');
    aliases.set(alias,name);return match.replace(name,alias);
  });
  const xml=new DOMParser().parseFromString(normalized,'application/xml');
  if(xml.querySelector('parsererror'))throw Error(t('xmlInvalidSyntax'));
  if(!xml.getElementsByTagName('colorScheme').length)throw Error(t('xmlMissingSchemes'));
  originalNames.set(xml,aliases);return xml;
}
export function serializeCamouflageXML(xml){
  const text=new XMLSerializer().serializeToString(xml),aliases=originalNames.get(xml);
  if(!aliases?.size)return text;
  return text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s/>])/g,(match,name)=>{
    return aliases.has(name)?match.replace(name,aliases.get(name)):match;
  });
}
