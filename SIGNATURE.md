# Signer l'application et publier les mises à jour

## 1. Pourquoi signer
Sans signature, Windows affiche « éditeur inconnu » (SmartScreen) à l'installation. L'application fonctionne, mais il faut cliquer sur
« Informations complémentaires » puis « Exécuter quand même ». La signature supprime cet avertissement (après quelques jours/téléchargements
pour un certificat standard, tout de suite avec un certificat EV).

## 2. Ce qu'il faut acheter (je ne peux pas le faire à votre place)
- un **certificat de signature de code** (fichier `.pfx`) auprès d'une autorité (Sectigo, DigiCert, SSL.com… environ 100 à 400 € par an), ou
- **Azure Trusted Signing** (abonnement Microsoft, moins cher, pour les entreprises ou associations vérifiées).
Un certificat est lié à une identité vérifiée (votre nom ou celui de votre structure) : l'achat passe par une vérification d'identité.

## 3. Brancher le certificat (une seule fois)
Dans le dépôt GitHub : *Settings > Secrets and variables > Actions > New repository secret*
- `CSC_LINK` : le fichier `.pfx` encodé en base64 (PowerShell : `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificat.pfx"))`)
- `CSC_KEY_PASSWORD` : le mot de passe du certificat

Le workflow `Release Windows app` signe alors automatiquement l'installateur et la version portable.

## 4. Publier une nouvelle version (mises à jour automatiques)
1. Changez `version` dans `package.json` (exemple : `7.5.0`).
2. Envoyez le projet sur GitHub, puis créez l'étiquette : `git tag v7.5.0 && git push origin v7.5.0`.
3. GitHub construit, signe (si le certificat est branché), vérifie l'application et publie une « Release » avec l'installateur.
4. Les applications installées trouvent la nouvelle version (vérification ~20 secondes après le démarrage, ou *Réglages > Rechercher une mise à jour*),
   la téléchargent, et l'installent à la fermeture de l'application.

La version **portable** ne se met pas à jour toute seule (c'est normal pour un fichier unique) : téléchargez la nouvelle.
Le dépôt doit être public, ou bien les applications ne pourront pas lire les mises à jour (un dépôt privé demande un jeton d'accès intégré, déconseillé).
