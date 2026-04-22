import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html, Sphere, Cylinder, Box, Torus, Environment } from '@react-three/drei';
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
      case 'box': return <Box args={[1.2, 1.2, 1.2]} radius={0.1} />;
      case 'cylinder': return <Cylinder args={[0.9, 0.9, 0.6, 64]} rotation={[Math.PI/2, 0, 0]} />;
      case 'sphere': return <Sphere args={[0.85, 64, 64]} />;
      default: return <Sphere args={[0.85, 64, 64]} />;
    }
  };

  return (
    <group position={node.position} ref={meshRef}>
      {getGeometry()}
      <meshPhysicalMaterial 
        color={node.color} 
        emissive={node.color}
        emissiveIntensity={isActive ? 1.5 : 0.2}
        roughness={0.1}
        metalness={0.1}
        transmission={0.8}
        thickness={1.5}
        clearcoat={1}
        clearcoatRoughness={0.1}
        transparent={true}
        opacity={0.9}
      />
      
      {isActive && (
        <Sphere args={[1.3, 32, 32]}>
          <meshBasicMaterial color={node.color} transparent opacity={0.1} wireframe />
        </Sphere>
      )}

      <Html position={[0, -1.4, 0]} center zIndexRange={[100, 0]}>
        <div style={{
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          padding: '6px 12px',
          borderRadius: '8px',
          color: 'white',
          fontSize: '11px',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          border: `1px solid rgba(255,255,255,0.1)`,
          boxShadow: `0 4px 12px rgba(0,0,0,0.2)`
        }}>
          {node.label}
        </div>
      </Html>
    </group>
  );
}

// Particle system to show events flowing
function FlowParticles({ source, target, color, playSequence }) {
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
    <Sphere args={[0.2, 32, 32]} ref={meshRef}>
      <meshBasicMaterial color={color} />
      <pointLight color={color} distance={4} intensity={3} />
    </Sphere>
  );
}

export default function Pipeline3D({ activeNode, flow }) {
  return (
    <Canvas camera={{ position: [0, 0, 11], fov: 45 }}>
      <color attach="background" args={['#020617']} />
      <Environment preset="city" />
      <ambientLight intensity={0.4} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={2} castShadow color="#ffffff" />
      <spotLight position={[-10, -10, -10]} angle={0.15} penumbra={1} intensity={1} color="#3b82f6" />
      
      <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 2 + 0.1} minPolarAngle={Math.PI / 3} />

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
