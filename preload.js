'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  chooseFiche: call('fiche:choose'),
  createFiche: call('fiche:create'),
  openFiche: call('fiche:open'),
  showFiche: call('fiche:show'),
  openSite: call('sites:open'),
  notes: { list: call('notes:list'), put: call('notes:put'), done: call('notes:done'), remove: call('notes:remove') },
  timetable: { get: call('timetable:get'), save: call('timetable:save'), pdf: call('timetable:pdf'), fromPhoto: call('timetable:fromPhoto') },
  cahier: { today: call('cahier:today'), day: call('cahier:day'), detail: call('cahier:detail'), setDay: call('cahier:setDay'), skip: call('cahier:skip'), setManual: call('cahier:setManual') },
  seating: { get: call('seating:get'), assign: call('seating:assign'), autofill: call('seating:autofill'), clear: call('seating:clear'), pdf: call('seating:pdf') },
  calendar: { view: call('calendar:view'), add: call('calendar:add') },
  backup: { create: call('backup:create'), pick: call('backup:pick'), restore: call('backup:restore') },
  settings: { get: call('settings:get'), setTheme: call('settings:setTheme'), setAutoUpdate: call('settings:setAutoUpdate'), openDataFolder: call('settings:openDataFolder'), openExternal: call('settings:openExternal'), copy: call('settings:copy') },
  update: { check: call('update:check'), install: call('update:install') },
  books: { list: call('books:list'), open: call('books:open'), setLast: call('books:setLast'), toggleMark: call('books:toggleMark'), setTone: call('books:setTone'), importPages: call('books:importPages'), importFolder: call('books:importFolder'), add: call('books:add'), remove: call('books:remove') },
  lang: { get: call('lang:get'), set: call('lang:set') },
  files: { list: call('files:list'), open: call('files:open'), reveal: call('files:reveal'), folder: call('files:folder'), remove: call('files:delete'), add: call('files:add') },
  logins: { list: call('logins:list'), save: call('logins:save'), remove: call('logins:delete') },
  auth: { fromImage: call('auth:fromImage'), codes: call('auth:codes'), add: call('auth:add'), remove: call('auth:remove') },
  on: (ch, fn) => { if (['nav', 'notes:changed', 'files:changed', 'update:status'].includes(ch)) ipcRenderer.on(ch, (_e, ...a) => fn(...a)); },
  classes: {
    list: call('classes:list'), pick: call('classes:pick'), createFromPick: call('classes:createFromPick'),
    createFromNames: call('classes:createFromNames'), get: call('classes:get'), save: call('classes:save'),
    remove: call('classes:remove'), arabicNames: call('classes:arabicNames'), grades: call('classes:grades'), pdf: call('classes:pdf')
  }
});
