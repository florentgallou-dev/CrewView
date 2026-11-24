# Graphismes de Crew View

Chaque élément de l'open-space est un fichier SVG de ce dossier. Pour changer un élément, enregistre un SVG au **même chemin** dans l'un de ces dossiers :

| Priorité | Dossier | Portée |
|---|---|---|
| 1 | `.crew-view/theme/` du projet | ce projet (à commiter) |
| 2 | dossier du réglage `crewView.themeDir` (CLI : `--theme-dir`) | tous tes projets |
| 3 | `resources/theme/` de l'extension (ce dossier) | thème par défaut |

- **Fichier par fichier :** un fichier absent, illisible ou mal formé est pris au niveau suivant. Tu peux donc ne remplacer que `decor/plante.svg`.
- **Rechargement à chaud :** l'open-space se met à jour environ une seconde après l'enregistrement.
- **Point de départ :** la commande **Crew View : Personnaliser les graphismes du projet** copie ce thème dans `.crew-view/theme/` sans écraser ce qui y est déjà.

## Conventions de dessin

**Échelle :** 1 unité SVG = 1 pixel de la scène au zoom 1. Le zoom agrandit les SVG sans perte de netteté.

**Point d'ancrage :** c'est l'**origine (0,0)** du SVG. C'est le point du dessin posé à l'endroit indiqué pour chaque fichier ci-dessous. Le `viewBox` délimite ce qui est visible et peut commencer en négatif, par exemple `viewBox="-27 -26 80 66"`. Les attributs `width` et `height` sont recalculés depuis le `viewBox`.

**Perspective isométrique** (mobilier, décor posé au sol, accessoires) :

| Déplacement dans la salle | Effet à l'écran |
|---|---|
| +1 en x (vers l'avant-droite) | (+32 ; +16) px |
| +1 en y (vers l'avant-gauche) | (−32 ; +16) px |
| +1 en hauteur | (0 ; −32) px |

Une dalle de sol mesure 64 × 32 px.

**Éléments muraux** (`mur-*`, `porte`, `enseigne`, `cadre`, `horloge`) : ils se dessinent **à plat, vus de face**, x vers la droite et y vers le bas. L'extension les incline sur le mur. Sur un mur, 1 tuile de longueur vaut 35,78 px et 1 tuile de hauteur vaut 32 px.

**Écrans** (`ecrans/*.svg`) : l'image est **étirée** sur la dalle de l'écran. Garde le format du `viewBox="0 0 46 32"`.

**`currentColor`** prend la couleur de l'agent : bandeau du bureau, tasse, lampe, bouclier, badge, dossier. Dans `ecrans/`, il prend la couleur du statut (violet pour la réflexion, rouge pour la question…). Dans `decor/gyrophare.svg`, il prend la couleur de l'état de l'équipe (bleu, rouge, orange, jaune, violet ou vert), et dans les deux `personnage/engrenage*.svg` celle de l'état de l'agent.

Les textes sont permis (`<text>`) avec les polices installées sur la machine. Les images ou polices externes ne sont pas chargées.

## Fichiers et ancrages

| Fichier | Ce que c'est | Ancre (0,0) |
|---|---|---|
| `mobilier/bureau.svg` | bureau d'un agent, 1,6 × 0,8 tuile, 0,75 de haut | coin arrière, au sol |
| `mobilier/bureau-chef.svg` | bureau de l'agent principal, 2,4 × 1 tuile | coin arrière, au sol |
| `mobilier/poste-partage.svg` | une place de la table des intérimaires, 1,2 × 0,8 tuile | coin arrière, au sol |
| `mobilier/moniteur.svg` | écran d'un bureau (la dalle animée est dessinée par-dessus) | coin arrière du pied, sur le plateau |
| `mobilier/portable.svg` | portable de la table partagée | coin arrière, sur le plateau |
| `decor/sol.svg` | motif de 2 × 2 dalles, répété sur tout le sol | coin arrière du motif |
| `decor/mur-fond.svg` | panneau du mur du fond, 1,4 tuile × 3, répété | coin haut-gauche |
| `decor/mur-gauche.svg` | panneau du mur de gauche, 1,1 tuile × 3, répété | coin haut-gauche (côté salle) |
| `decor/porte.svg` | porte de l'intérim et son panneau | coin haut de la porte, côté salle |
| `decor/enseigne.svg` | « CREW » ; le nom du projet est écrit 20 px dessous | début de la ligne de base |
| `decor/cadre.svg` | cadre au-dessus du bureau principal | coin haut-gauche |
| `decor/horloge.svg` | cadran ; les aiguilles sont dessinées par l'extension | centre |
| `decor/gyrophare.svg` | gyrophare fixé dans l'angle du fond, **dessiné de face** (non incliné) ; reflet, faisceaux et halo sont animés autour du point (0 ; −6) | milieu du bas du dôme, posé sur l'arête de l'angle |
| `decor/armoire.svg` | armoire (deux exemplaires contre le mur de gauche) | coin arrière, au sol |
| `decor/fontaine.svg` | fontaine à eau ; la bulle est animée | coin arrière, au sol |
| `decor/plante.svg` | grande plante ; la seconde est la même, réduite à 80 % | coin arrière du pot, au sol |
| `accessoires/*.svg` | objet posé à gauche sur le bureau | point du plateau où il est posé |
| `accessoires/serveur.svg` | baie posée au sol, à droite du bureau ; les voyants sont animés | coin arrière, au sol |
| `ecrans/*.svg` | fond de l'écran selon le statut (voir ci-dessous) | étiré sur la dalle |
| `personnage/tete.svg` | tête | centre de la tête |
| `personnage/buste.svg` | buste de face, 40 px de haut | milieu des épaules |
| `personnage/buste-dos.svg` | buste de dos, au travail face à l'écran | milieu des épaules |
| `personnage/bras.svg` | bras (épaule → coude) | articulation de départ |
| `personnage/avant-bras.svg` | avant-bras (coude → main) | articulation de départ |
| `personnage/jambe.svg` | jambe (hanche → pied), visible en marchant | articulation de départ |
| `personnage/articulation.svg` | rond posé sur chaque épaule, coude, main, hanche et pied | centre |
| `personnage/dossier.svg` | dossier porté lors d'une délégation | centre |
| `personnage/engrenage.svg` | grand engrenage d'un agent occupé, en haut à droite de sa tête ; une dent pointe vers la droite | centre de rotation |
| `personnage/engrenage-petit.svg` | petit engrenage, engrené avec le grand ; une dent pointe vers la droite | centre de rotation |

**Écrans par statut :**

| Fichier | Statut | Animation ajoutée par-dessus |
|---|---|---|
| `veille` | au repos | point lumineux qui se promène |
| `reflexion` | réflexion | trois points |
| `lecture` | lecture | lignes qui défilent |
| `ecriture` | écriture | lignes de code |
| `terminal` | exécution de commandes | lignes vertes |
| `discussion` | discussion | lignes |
| `delegation` | délégation | aucune |
| `question` | attend ta réponse | aucune |
| `termine` | tâche terminée | aucune |

## Le personnage : pièces animées

Les postures (marche, frappe au clavier, bras levé, main derrière la tête, dossier porté) sont calculées par l'extension. Elle place et tourne tes pièces aux bons endroits :

- **Buste et tête :** le buste est posé par le milieu des épaules, puis la tête au point `tete`. Pendant la marche, le buste est compressé en hauteur pour laisser voir les jambes.
- **Membres :** chacun se dessine **à l'horizontale**, de son articulation de départ (0,0) vers la droite, sur la longueur indiquée dans `pivots.json`. L'extension le tourne et l'**étire dans sa longueur** pour relier les deux articulations. Évite donc les détails aux extrémités : c'est le rôle d'`articulation.svg`.

**`personnage/pivots.json`** (pixels de scène, y vers le bas) :

| Clé | Sens |
|---|---|
| `tete` | centre de la tête par rapport au milieu des épaules |
| `epaule` | épaule droite par rapport au milieu des épaules (la gauche est symétrique) |
| `hanche` | hanche droite par rapport au milieu du bas du buste |
| `dossier` | centre du dossier porté par rapport au milieu des épaules (côté de la marche) |
| `longueurs` | longueur dessinée de `bras`, `avant-bras` et `jambe` dans leur SVG |
| `engrenages` | pour `grand` et `petit` : nombre de `dents` et `centre` par rapport au sommet de la tête |

**Engrenages :** l'extension fait tourner les deux roues en sens inverse, à des vitesses inversement proportionnelles à leur nombre de dents, et les cale pour qu'une dent de l'une tombe dans un creux de l'autre. Si tu les redessines, garde une dent pointée vers la droite dans chaque SVG, indique leur nombre de dents dans `pivots.json`, et place les centres à une distance égale à la somme des rayons primitifs (rayon primitif = module × dents / 2 ; par défaut 0,95 × 14 / 2 + 0,95 × 9 / 2 = 10,925).

## Ce qui reste dessiné par l'extension

- les textes variables : noms des agents, nom du projet, bulles ;
- les ombres et les zones colorées au sol ;
- la lumière de la salle ;
- les arêtes du haut des murs ;
- les animations : lignes des écrans, lueur, aiguilles de l'horloge, rotation du gyrophare et des engrenages, bulle de la fontaine, voyants du serveur.
