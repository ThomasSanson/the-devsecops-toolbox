# language: fr
@gitlab-connexion
Fonctionnalité: Connexion à GitLab
  En tant qu'utilisateur
  Je veux me connecter à GitLab
  Afin d'accéder au tableau de bord

  Scénario: Connexion avec les identifiants root
    Quand je me connecte à GitLab avec les identifiants root
    Alors le tableau de bord GitLab est affiché
    Et la page du tableau de bord GitLab correspond à la référence visuelle
