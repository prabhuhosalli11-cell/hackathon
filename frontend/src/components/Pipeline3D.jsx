import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html, Sphere, Cylinder, Box, Torus } from '@react-three/drei';
import * as THREE from 'three';

// Nodes in our pipeline
const nodes = [
  { id: 'producer', label: 'Producer (App)', position: [-6, 0, 0], color: '#3b82f6', shape: 'box' },
  { id: 'kafka_raw', label: 'Topic: raw-events', position: [-2, 1.5, 0], color: '#f59e0b', shape: 'cylinder' },
  { id: 'consumer', label: 'Consumer', position: [0, -1, 0], color: '#8b5cf6', shape: 'sphere' },
  { id: 'redis', label: 'Redis (Cache/Idemp)', position: [2, -3, 0], color: '#ef4444', shape: 'cylinder' },
  { id: 'api', label: 'User Service API', position: [-2, -3, 0], color: '#10b981', shape: 'box' },
  { id: 'kafka_enriched', label: 'Topic: enriched-events', position: [4, 1.5, 0], color: '#f59e0b', shape: 'cylinder' },
];

function NodeMesh({ node, activeId }) {
  const meshRef = useRef();
  const isActive = activeId === node.id;
  
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.position.y = node.position[1] + Math.sin(t * 2 + node.position[0]) * 0.1;
      if (node.shape === 'box') {
        meshRef.current.rotation.y = t * 0.5;
        meshRef.current.rotation.x = t * 0.3;
      }
    }
  });

  const getGeometry = () => {
    switch (node.shape) {
      case 'box': return <Box args={[1, 1, 1]} />;
      case 'cylinder': return <Cylinder args={[0.8, 0.8, 0.5, 32]} rotation={[Math.PI/2, 0, 0]} />;
      case 'sphere': return <Sphere args={[0.7, 32, 32]} />;
      default: return <Sphere args={[0.7, 32, 32]} />;
    }
  };

  return (
    <group position={node.position} ref={meshRef}>
      {getGeometry()}
      <meshStandardMaterial 
        color={isActive ? '#ffffff' : node.color} 
        emissive={node.color}
        emissiveIntensity={isActive ? 2 : 0.5}
        roughness={0.2}
        metalness={0.8}
        wireframe={node.shape === 'sphere' ? true : false}
      />
      
      {isActive && (
        <Sphere args={[1.2, 16, 16]}>
          <meshBasicMaterial color={node.color} transparent opacity={0.2} wireframe />
        </Sphere>
      )}

      <Html position={[0, -1.2, 0]} center>
        <div style={{
          background: 'rgba(15, 23, 42, 0.8)',
          padding: '4px 8px',
          borderRadius: '4px',
          color: 'white',
          fontSize: '10px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          border: `1px solid ${node.color}`
        }}>
          {node.label}
        </div>
      </Html>
    </group>
  );
}

// Particle system to show events flowing
function FlowParticles({ source, target, color, playSequence }) {
  const particlesCount = 5;
  const meshRef = useRef();
  
  useFrame((state) => {
    if (!playSequence) return;
    const t = (state.clock.getElapsedTime() * 2) % 1; // 0 to 1
    
    // Lerp position
    if (meshRef.current) {
      meshRef.current.position.lerpVectors(
        new THREE.Vector3(...source), 
        new THREE.Vector3(...target), 
        t
      );
    }
  });

  if (!playSequence) return null;

  return (
    <Sphere args={[0.15, 16, 16]} ref={meshRef}>
      <meshBasicMaterial color={color} />
      <pointLight color={color} distance={3} intensity={2} />
    </Sphere>
  );
}

export default function Pipeline3D({ activeNode, flow }) {
  return (
    <Canvas camera={{ position: [0, 0, 10], fov: 45 }}>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
      
      <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} maxPolarAngle={Math.PI / 2} minPolarAngle={Math.PI / 4} />

      {/* Render Nodes */}
      {nodes.map(node => (
        <NodeMesh key={node.id} node={node} activeId={activeNode} />
      ))}

      {/* Flow Lines visually indicating connections */}
      {/* Producer -> Raw */}
      <FlowParticles source={[-6, 0, 0]} target={[-2, 1.5, 0]} color="#3b82f6" playSequence={flow === 'produce'} />
      {/* Raw -> Consumer */}
      <FlowParticles source={[-2, 1.5, 0]} target={[0, -1, 0]} color="#f59e0b" playSequence={flow === 'consume'} />
      {/* Consumer <-> API */}
      <FlowParticles source={[0, -1, 0]} target={[-2, -3, 0]} color="#10b981" playSequence={flow === 'api'} />
      {/* Consumer <-> Redis */}
      <FlowParticles source={[0, -1, 0]} target={[2, -3, 0]} color="#ef4444" playSequence={flow === 'redis'} />
      {/* Consumer -> Enriched */}
      <FlowParticles source={[0, -1, 0]} target={[4, 1.5, 0]} color="#8b5cf6" playSequence={flow === 'enrich'} />

    </Canvas>
  );
}
