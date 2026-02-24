# Design — CLI Interactive AUTODEV by Sooatek

> Date : 2026-02-24
> Objectif : Ajouter un mode interactif menu-driven au-dessus du CLI existant

## Contexte

Autodev est aujourd'hui 100% non-interactif (flags CLI). L'objectif est d'ajouter un mode interactif style Claude Code — menus avec choix — pour les humains, tout en gardant le mode CLI intact pour l'automatisation.

## Principes

- **Coexistence** : `autodev` sans arguments = mode interactif, avec flags = mode CLI classique
- **Zéro duplication** : le mode interactif appelle les mêmes fonctions lib que le CLI
- **Dépendance unique** : `@inquirer/prompts` pour les menus
- **Couleurs ANSI natives** : pas de chalk, helpers codés à la main

## Architecture

### Fichiers

```
bin/
  autodev.mjs                 ← modifié (si argv.length <= 2 → interactive)
  autodev-interactive.mjs     ← nouveau (banner + menus + sous-menus)
```

### Détection du mode

Dans `bin/autodev.mjs`, avant le parsing commander : si `process.argv.length <= 2`, import dynamique de `autodev-interactive.mjs` et lancement.

## Flow interactif

### Lancement

1. Scan `projects/*.json` → liste les projets
2. 1 seul projet → auto-sélection
3. Plusieurs → select pour choisir
4. Affiche banner ASCII + version + projet actif
5. Boucle menu principal

### Banner

```
   ___       ___       ___       ___       ___       ___       ___
  /\  \     /\__\     /\  \     /\  \     /\  \     /\  \     /\__\
 /::\  \   /:/ _/_    \:\  \   /::\  \   /::\  \   /::\  \   /:/ _/_
/::\:\__\ /:/_/\__\   /::\__\ /:/\:\__\ /:/\:\__\ /::\:\__\ |::L/\__\
\/\::/  / \:\/:/  /  /:/\/__/ \:\/:/  / \:\/:/  / \:\:\/  / |::::/  /
  /:/  /   \::/  /   \/__/     \::/  /   \::/  /   \:\/  /   L;;/__/
  \/__/     \/__/               \/__/     \/__/     \/__/

                    --- by Sooatek ---
                       v0.1.0

  Projet : HIVE (hive2)
```

Couleurs via ANSI escape codes (cyan pour le logo, dim pour la version).

### Menu principal

```
1. Executer un ticket
2. Release
3. Sprint
4. Planning
5. Verification
6. Export
7. Init projet
8. Changer de projet
9. Quitter
```

Boucle : apres chaque action, retour au menu principal.

### Sous-menus

**Executer un ticket :**
- select: "Ticket specifique" / "Prochain disponible"
- si specifique: input ticket key
- confirm: "Auto-close ?"
- confirm: "Dry-run ?"
- si next + auto-close: input "Parallel workers (1-4)"

**Release :**
- select: "Version manuelle" / "Auto-detect"
- si manuelle: input version name
- confirm: "Dry-run ?"

**Sprint :**
- select: "Fermer le sprint actif" / "Velocite" / "Tickets stale"
- si close: confirm "Dry-run ?", confirm "Generer recap ?"
- si stale: input "Seuil en jours (defaut 7)"

**Planning :**
- input: "Chemin du fichier plan"
- select: "Flow complet" / "Analyze" / "Sprints" / "Tasks" / "Validate" / "Import"
- si import: confirm "Dry-run ?"

**Verification :**
- input optionnel: "Sprint name (vide = tous)"

**Export :**
- input optionnel: "Sprint name (vide = tous)"

## Integration

Chaque sous-menu collecte les options et appelle directement les fonctions lib existantes :

| Menu | Fonction appelee |
|------|-----------------|
| Executer ticket | `processTicket(config, key, opts)` |
| Release | `performRelease(config, opts)` |
| Sprint > Close | `closeActiveSprint(config, opts)` |
| Sprint > Velocite | `getVelocity(config)` |
| Sprint > Stale | `getStaleTickets(config, days)` |
| Planning | `stepAnalyze/stepSprints/stepTasks/stepValidate/stepImport` |
| Verification | `verifyDoneTasks(config, opts)` |
| Export | `exportDoneTasks(config, opts)` |
| Init | `ensureProjectContext(config)` |

## Dependance

Ajout unique : `@inquirer/prompts` dans package.json.

Pas de chalk, pas de figlet, pas de boxen. ANSI escape codes pour les couleurs.
