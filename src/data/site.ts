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
      'We wanted to know whether robustness results measured offline predict what happens when the same perturbations are applied to an autonomous vehicle. We first tested the models offline and then repeated the experiments on Fortuna. Across more than 740 experiments, the relationship was weaker than we expected. We also tested whether fine-tuning on perturbed data improved real driving performance.',
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
      'We wanted to know whether we could predict which scenarios are likely to expose failures before running a full test suite. We built Foresee, which monitors nearby agents, ranks near misses by risk, and clips and fuzzes the scenario around them. Focusing the search this way found failures using a smaller testing budget than an unfocused search.',
    paper: 'https://doi.org/10.1145/3744916.3787829',
  },
  {
    year: '2026',
    venue: 'ASE · Tools & Datasets',
    title: 'Cam2Sim: Neural Scenario Reconstruction for Closed-Loop Autonomous Driving Simulation',
    authors:
      'Davide Jannussi, Stefano Carlo Lambertenghi, Constantin Carste, Andrea Stocco',
    summary:
      'We had many hours of real driving recordings, but once an experiment was finished we could only replay the recorded sensor data. Cam2Sim reconstructs the recorded environment in CARLA and uses Gaussian Splatting for the camera view, so we can reuse real experiments for closed-loop simulation.',
    paper: 'https://arxiv.org/abs/2607.04770',
    code: 'https://github.com/ast-fortiss-tum/cam2sim',
  },
  {
    year: '2025',
    venue: 'ASE',
    title: 'A Multi-Modality Evaluation of the Reality Gap in Autonomous Driving Systems',
    authors: 'Stefano Carlo Lambertenghi, Mirena Flores Valdez, Andrea Stocco',
    summary:
      "We wanted to know how much an autonomous driving system's behavior changes as it moves from simulation to a real vehicle, and whether an intermediate setup closes part of that gap. We compared simulation, vehicle-in-the-loop, mixed-reality, and real-world testing on a small-scale vehicle and its digital twin, for both end-to-end and modular models. Vehicle-in-the-loop reduced the actuation gap, and mixed-reality testing reduced the perception gap compared to simulation alone.",
    paper: 'https://doi.org/10.1109/ASE63991.2025.00230',
    code: 'https://github.com/ast-fortiss-tum/ROS-small-scale-vehicle',
  },
  {
    year: '2025',
    venue: 'ICST',
    title: 'Benchmarking Image Perturbations for Testing Automated Driving Assistance Systems',
    authors: 'Stefano Carlo Lambertenghi, Hannes Leonhard, Andrea Stocco',
    summary:
      'We wanted to know which kinds of image perturbations expose weaknesses in automated-driving perception and control, and whether training on perturbed images helps. We benchmarked 38 perturbation types across camera-based driving systems. Training on perturbed images improved robustness under adverse conditions.',
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
      'We wanted to know whether standard image-quality metrics track how neural image translation affects a driving system, rather than just how it looks to a human. We tested this across vehicle detection and end-to-end lane keeping using several metrics and translation methods. The metrics did not track downstream performance consistently across both tasks, which argues for using them carefully as a proxy.',
    paper: 'https://doi.org/10.1109/ICST60714.2024.00024',
    code: 'https://github.com/ast-fortiss-tum/I2I-quality-metrics-study',
  },
  {
    year: '2023',
    venue: 'ICRA',
    title: 'Ultra-Low Power Deep Learning-based Monocular Relative Localization Onboard Nano-Quadrotors',
    authors: 'Stefano Bonato, Stefano Carlo Lambertenghi, Elia Cereda, Alessandro Giusti, Daniele Palossi',
    summary:
      'We wanted to know whether two nano-drones could localize each other in real time using only a single onboard camera, within the power budget of a 40-gram quadrotor. We trained a small neural network for this and deployed it onboard. It ran at 48 Hz using about 95 mW and reached a mean localization error of about 15 cm in flight tests.',
    paper: 'https://arxiv.org/abs/2303.01940',
  },
];
