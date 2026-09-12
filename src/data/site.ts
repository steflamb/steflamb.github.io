export const navItems = [
  { label: 'Home', href: '/' },
  { label: 'Fortuna', href: '/fortuna/' },
  { label: 'Research', href: '/research/' },
  { label: 'Publications', href: '/publications/' },
  { label: 'About', href: '/about/' },
  { label: 'CV', href: '/cv/' },
  { label: 'Just for fun', href: '/garage/' },
];

export const profileLinks = {
  email: 'mailto:lambertenghi@fortiss.org',
  github: 'https://github.com/steflamb',
  researchGroup: 'https://github.com/ast-fortiss-tum',
  dblp: 'https://dblp.org/pid/341/5500',
  linkedin: 'https://www.linkedin.com/in/stefano-carlo-lambertenghi-a30b9592/',
  scholar: 'https://scholar.google.com/citations?hl=en&user=GRb-W38AAAAJ',
  cvPdf: '/files/stefano-lambertenghi-cv.pdf',
};

export type Publication = {
  year: string;
  venue: string;
  title: string;
  authors: string;
  summary: string;
  paper: string;
  code?: string;
  note?: string;
};

export const publications: Publication[] = [
  {
    year: '2026',
    venue: 'ASE',
    title: 'Real-World Perturbation Testing of Autonomous Driving Systems',
    authors: 'Stefano Carlo Lambertenghi, Matthias Weil, Andrea Stocco',
    summary:
      'Compares 72 camera and LiDAR perturbations across offline, hardware-in-the-loop, and full-scale closed-loop vehicle testing.',
    paper: 'https://arxiv.org/abs/2607.04953',
    code: 'https://doi.org/10.5281/zenodo.21536524',
  },
  {
    year: '2026',
    venue: 'ICSE',
    title: 'Misbehavior Forecasting for Focused Autonomous Driving Systems Testing',
    authors:
      'M. M. Abid Naziri, Stefano Carlo Lambertenghi, Andrea Stocco, Marcelo d’Amorim',
    summary:
      'Uses near-miss forecasting to focus simulation-based testing on scenarios that are more likely to expose failures.',
    paper: 'https://doi.org/10.1145/3744916.3787829',
  },
  {
    year: '2026',
    venue: 'ASE · Tools & Datasets',
    title: 'Cam2Sim: Neural Scenario Reconstruction for Closed-Loop Autonomous Driving Simulation',
    authors:
      'Davide Jannussi, Stefano Carlo Lambertenghi, Constantin Carste, Andrea Stocco',
    summary:
      'Turns real driving recordings into playable CARLA scenarios, combining scene reconstruction with Gaussian Splatting.',
    paper: 'https://arxiv.org/abs/2607.04770',
    code: 'https://github.com/ast-fortiss-tum/cam2sim',
  },
  {
    year: '2025',
    venue: 'ASE',
    title: 'A Multi-Modality Evaluation of the Reality Gap in Autonomous Driving Systems',
    authors: 'Stefano Carlo Lambertenghi, Mirena Flores Valdez, Andrea Stocco',
    summary:
      'Compares SiL, ViL, mixed-reality, and real-world testing using a small-scale vehicle and its digital twin.',
    paper: 'https://doi.org/10.1109/ASE63991.2025.00230',
    code: 'https://github.com/ast-fortiss-tum/ROS-small-scale-vehicle',
  },
  {
    year: '2025',
    venue: 'ICST',
    title: 'Benchmarking Image Perturbations for Testing Automated Driving Assistance Systems',
    authors: 'Stefano Carlo Lambertenghi, Hannes Leonhard, Andrea Stocco',
    summary:
      'A broad evaluation of image perturbations for exposing robustness issues in autonomous-driving perception and control.',
    paper: 'https://doi.org/10.1109/ICST62969.2025.10988980',
    code: 'https://github.com/ast-fortiss-tum/perturbation-drive',
    note: 'IEEE Computer Society TCSE Distinguished Paper Award',
  },
  {
    year: '2024',
    venue: 'ICST',
    title: 'Assessing Quality Metrics for Neural Reality Gap Input Mitigation in Autonomous Driving Testing',
    authors: 'Stefano Carlo Lambertenghi, Andrea Stocco',
    summary:
      'Tests whether image-quality metrics track how neural image translation affects vehicle detection and end-to-end lane keeping.',
    paper: 'https://doi.org/10.1109/ICST60714.2024.00024',
    code: 'https://github.com/ast-fortiss-tum/I2I-quality-metrics-study',
  },
  {
    year: '2023',
    venue: 'ICRA',
    title: 'Ultra-Low Power Deep Learning-based Monocular Relative Localization Onboard Nano-Quadrotors',
    authors: 'Stefano Bonato, Stefano Carlo Lambertenghi, Elia Cereda, Alessandro Giusti, Daniele Palossi',
    summary:
      'A deep-learning pipeline for nano-drones to localize a peer drone from a single camera, running onboard at 48 Hz using only 95 mW.',
    paper: 'https://arxiv.org/abs/2303.01940',
  },
];
