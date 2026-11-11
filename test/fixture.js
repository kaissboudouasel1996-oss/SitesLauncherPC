'use strict';
const line = (i) => ({ text: '-Demander aux élèves de relever dans le texte les mots et les expressions liés aux thèmes étudiés, puis de justifier leur réponse (Activité ' + i + ', page 1' + i + ').', mode: false });
function data(nBlocs, nLines) {
  return {
    niveau: '3AC', semestre: '1', seance: '4', unite: '1', uniteTitre: 'Voyages et expériences', tache: 'Rédiger une lettre pour raconter une expérience de voyage.', titre: '',
    objectifs: ['Relever des indices et déduire l’idée générale et les idées principales d’un texte.'],
    ouverture: ['-Déclaration des objectifs.', '-Annoncer le contrat de la classe.', '-Contrôle des devoirs : Compléter le tableau en relevant dans le texte les mots et les expressions liés aux thèmes (Activité 1, page 17).'], dureeOuverture: '5 min',
    blocs: Array.from({ length: nBlocs }, (_, b) => ({ duree: '15 min', rows: [
      { label: 'Modelage ' + (b + 1) + ' : Compréhension détaillée', paras: Array.from({ length: nLines }, (_, i) => line(i)) },
      { label: 'Pratiques guidées', paras: [{ text: 'Collective :', mode: true }].concat(Array.from({ length: nLines }, (_, i) => line(i))) }] })),
    cloture: ['-Demander aux élèves de rappeler ce qu’ils ont appris.', '-Faire la synthèse de la séance.'], dureeCloture: '5 min'
  };
}

module.exports = { data };
